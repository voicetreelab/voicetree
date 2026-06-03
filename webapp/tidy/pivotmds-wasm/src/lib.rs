use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use wasm_bindgen::prelude::*;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotMdsNode {
    id: String,
    x: f64,
    y: f64,
    fixed: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct PivotMdsEdge {
    source: String,
    target: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotMdsInput {
    nodes: Vec<PivotMdsNode>,
    edges: Vec<PivotMdsEdge>,
    pivot_count: Option<usize>,
    edge_length: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PivotMdsPosition {
    id: String,
    x: f64,
    y: f64,
}

#[wasm_bindgen(js_name = runPivotMdsWasmProjection)]
pub fn run_pivot_mds_wasm_projection(input: JsValue) -> Result<JsValue, JsValue> {
    let input: PivotMdsInput = serde_wasm_bindgen::from_value(input)
        .map_err(|error| JsValue::from_str(&format!("invalid PivotMDS input: {error}")))?;
    let positions = seed_positions(&input);
    serde_wasm_bindgen::to_value(&positions)
        .map_err(|error| JsValue::from_str(&format!("failed to serialize PivotMDS output: {error}")))
}

pub fn seed_positions(input: &PivotMdsInput) -> Vec<PivotMdsPosition> {
    if input.nodes.is_empty() {
        return Vec::new();
    }

    let edge_length = finite_positive(input.edge_length, 350.0);
    let graph = IndexedGraph::from_input(input);
    let mut output = input
        .nodes
        .iter()
        .map(|node| PivotMdsPosition {
            id: node.id.clone(),
            x: node.x,
            y: node.y,
        })
        .collect::<Vec<_>>();

    for component in graph.components() {
        let component_positions = seed_component(&graph, &component, input.pivot_count, edge_length);
        for (local_index, position) in component_positions.into_iter().enumerate() {
            let node_index = component[local_index];
            output[node_index].x = position.0;
            output[node_index].y = position.1;
        }
    }

    output
}

struct IndexedGraph<'a> {
    nodes: &'a [PivotMdsNode],
    adjacency: Vec<Vec<usize>>,
}

impl<'a> IndexedGraph<'a> {
    fn from_input(input: &'a PivotMdsInput) -> Self {
        let mut adjacency = vec![Vec::<usize>::new(); input.nodes.len()];
        for edge in &input.edges {
            let Some(source) = input.nodes.iter().position(|node| node.id == edge.source) else {
                continue;
            };
            let Some(target) = input.nodes.iter().position(|node| node.id == edge.target) else {
                continue;
            };
            if source == target {
                continue;
            }
            adjacency[source].push(target);
            adjacency[target].push(source);
        }
        for neighbors in &mut adjacency {
            neighbors.sort_unstable();
            neighbors.dedup();
        }
        Self {
            nodes: &input.nodes,
            adjacency,
        }
    }

    fn components(&self) -> Vec<Vec<usize>> {
        let mut visited = vec![false; self.nodes.len()];
        let mut components = Vec::new();
        for start in 0..self.nodes.len() {
            if visited[start] {
                continue;
            }
            let mut queue = VecDeque::from([start]);
            visited[start] = true;
            let mut component = Vec::new();
            while let Some(node) = queue.pop_front() {
                component.push(node);
                for &neighbor in &self.adjacency[node] {
                    if !visited[neighbor] {
                        visited[neighbor] = true;
                        queue.push_back(neighbor);
                    }
                }
            }
            component.sort_unstable();
            components.push(component);
        }
        components
    }
}

fn seed_component(
    graph: &IndexedGraph<'_>,
    component: &[usize],
    requested_pivots: Option<usize>,
    edge_length: f64,
) -> Vec<(f64, f64)> {
    if component.len() == 1 {
        let node = &graph.nodes[component[0]];
        return vec![(node.x, node.y)];
    }

    let pivots = choose_pivots(graph, component, requested_pivots);
    let distances = pivots
        .iter()
        .map(|&pivot| bfs_distances(graph, pivot))
        .collect::<Vec<_>>();
    let features = centered_distance_features(component, &distances, edge_length);
    let raw = project_features_2d(&features);
    align_to_current_positions(graph, component, raw)
}

fn choose_pivots(
    graph: &IndexedGraph<'_>,
    component: &[usize],
    requested_pivots: Option<usize>,
) -> Vec<usize> {
    let pivot_count = requested_pivots
        .unwrap_or_else(|| ((component.len() as f64).sqrt().ceil() as usize * 2).clamp(2, 24))
        .clamp(1, component.len());
    let mut pivots = vec![component[0]];
    let mut nearest = vec![usize::MAX; graph.nodes.len()];

    while pivots.len() < pivot_count {
        let latest = *pivots.last().expect("first pivot exists");
        let distances = bfs_distances(graph, latest);
        for &node in component {
            nearest[node] = nearest[node].min(distances[node]);
        }
        let Some(next) = component
            .iter()
            .copied()
            .filter(|node| !pivots.contains(node))
            .max_by_key(|node| (nearest[*node], std::cmp::Reverse(*node)))
        else {
            break;
        };
        pivots.push(next);
    }

    pivots
}

fn bfs_distances(graph: &IndexedGraph<'_>, start: usize) -> Vec<usize> {
    let mut distances = vec![usize::MAX; graph.nodes.len()];
    let mut queue = VecDeque::from([start]);
    distances[start] = 0;
    while let Some(node) = queue.pop_front() {
        let next_distance = distances[node] + 1;
        for &neighbor in &graph.adjacency[node] {
            if distances[neighbor] == usize::MAX {
                distances[neighbor] = next_distance;
                queue.push_back(neighbor);
            }
        }
    }
    distances
}

fn centered_distance_features(
    component: &[usize],
    pivot_distances: &[Vec<usize>],
    edge_length: f64,
) -> Vec<Vec<f64>> {
    let rows = component.len();
    let cols = pivot_distances.len();
    let mut squared = vec![vec![0.0; cols]; rows];
    for (row, &node) in component.iter().enumerate() {
        for (col, distances) in pivot_distances.iter().enumerate() {
            let hops = distances[node].min(component.len());
            let distance = hops as f64 * edge_length;
            squared[row][col] = distance * distance;
        }
    }

    let row_means = squared
        .iter()
        .map(|row| row.iter().sum::<f64>() / cols.max(1) as f64)
        .collect::<Vec<_>>();
    let col_means = (0..cols)
        .map(|col| squared.iter().map(|row| row[col]).sum::<f64>() / rows.max(1) as f64)
        .collect::<Vec<_>>();
    let total_mean = row_means.iter().sum::<f64>() / rows.max(1) as f64;

    (0..rows)
        .map(|row| {
            (0..cols)
                .map(|col| -0.5 * (squared[row][col] - row_means[row] - col_means[col] + total_mean))
                .collect::<Vec<_>>()
        })
        .collect()
}

fn project_features_2d(features: &[Vec<f64>]) -> Vec<(f64, f64)> {
    if features.is_empty() {
        return Vec::new();
    }
    let covariance = covariance_matrix(features);
    let first = dominant_eigenvector(&covariance, None);
    let second = dominant_eigenvector(&covariance, Some(&first));

    let mut projected = features
        .iter()
        .map(|row| (dot(row, &first), dot(row, &second)))
        .collect::<Vec<_>>();
    normalize_projection(&mut projected);
    projected
}

fn covariance_matrix(features: &[Vec<f64>]) -> Vec<Vec<f64>> {
    let cols = features.first().map_or(0, Vec::len);
    let mut covariance = vec![vec![0.0; cols]; cols];
    for row in features {
        for i in 0..cols {
            for j in i..cols {
                covariance[i][j] += row[i] * row[j];
            }
        }
    }
    for i in 0..cols {
        for j in 0..i {
            covariance[i][j] = covariance[j][i];
        }
    }
    covariance
}

fn dominant_eigenvector(matrix: &[Vec<f64>], orthogonal_to: Option<&[f64]>) -> Vec<f64> {
    let size = matrix.len();
    if size == 0 {
        return Vec::new();
    }
    let mut vector = (0..size)
        .map(|index| ((index + 1) as f64).sin())
        .collect::<Vec<_>>();
    orthogonalize(&mut vector, orthogonal_to);
    normalize_vector(&mut vector);

    for _ in 0..48 {
        let mut next = matrix
            .iter()
            .map(|row| dot(row, &vector))
            .collect::<Vec<_>>();
        orthogonalize(&mut next, orthogonal_to);
        if vector_norm(&next) <= 1e-9 {
            break;
        }
        normalize_vector(&mut next);
        vector = next;
    }

    vector
}

fn align_to_current_positions(
    graph: &IndexedGraph<'_>,
    component: &[usize],
    raw: Vec<(f64, f64)>,
) -> Vec<(f64, f64)> {
    let fixed_local_indices = component
        .iter()
        .enumerate()
        .filter_map(|(local_index, &node_index)| graph.nodes[node_index].fixed.then_some(local_index))
        .collect::<Vec<_>>();
    let anchors = if fixed_local_indices.is_empty() {
        (0..component.len()).collect::<Vec<_>>()
    } else {
        fixed_local_indices
    };

    let raw_centroid = centroid(anchors.iter().map(|&index| raw[index]));
    let current_centroid = centroid(anchors.iter().map(|&index| {
        let node = &graph.nodes[component[index]];
        (node.x, node.y)
    }));
    let transform = similarity_transform(graph, component, &raw, &anchors, raw_centroid, current_centroid);

    component
        .iter()
        .enumerate()
        .map(|(local_index, &node_index)| {
            let node = &graph.nodes[node_index];
            if node.fixed {
                return (node.x, node.y);
            }
            transform.apply(raw[local_index])
        })
        .collect()
}

#[derive(Clone, Copy)]
struct SimilarityTransform {
    scale: f64,
    cos: f64,
    sin: f64,
    raw_centroid: (f64, f64),
    current_centroid: (f64, f64),
}

impl SimilarityTransform {
    fn apply(self, point: (f64, f64)) -> (f64, f64) {
        let x = point.0 - self.raw_centroid.0;
        let y = point.1 - self.raw_centroid.1;
        (
            self.current_centroid.0 + self.scale * (self.cos * x - self.sin * y),
            self.current_centroid.1 + self.scale * (self.sin * x + self.cos * y),
        )
    }
}

fn similarity_transform(
    graph: &IndexedGraph<'_>,
    component: &[usize],
    raw: &[(f64, f64)],
    anchors: &[usize],
    raw_centroid: (f64, f64),
    current_centroid: (f64, f64),
) -> SimilarityTransform {
    let mut a = 0.0;
    let mut b = 0.0;
    let mut raw_energy = 0.0;
    let mut current_energy = 0.0;

    for &local_index in anchors {
        let raw_x = raw[local_index].0 - raw_centroid.0;
        let raw_y = raw[local_index].1 - raw_centroid.1;
        let node = &graph.nodes[component[local_index]];
        let current_x = node.x - current_centroid.0;
        let current_y = node.y - current_centroid.1;
        a += raw_x * current_x + raw_y * current_y;
        b += raw_x * current_y - raw_y * current_x;
        raw_energy += raw_x * raw_x + raw_y * raw_y;
        current_energy += current_x * current_x + current_y * current_y;
    }

    let rotation_norm = (a * a + b * b).sqrt();
    let scale = if raw_energy > 1e-9 && current_energy > 1e-9 {
        (current_energy / raw_energy).sqrt().clamp(0.25, 4.0)
    } else {
        1.0
    };

    SimilarityTransform {
        scale,
        cos: if rotation_norm > 1e-9 { a / rotation_norm } else { 1.0 },
        sin: if rotation_norm > 1e-9 { b / rotation_norm } else { 0.0 },
        raw_centroid,
        current_centroid,
    }
}

fn normalize_projection(points: &mut [(f64, f64)]) {
    let center = centroid(points.iter().copied());
    for point in points.iter_mut() {
        point.0 -= center.0;
        point.1 -= center.1;
    }
    let spread = points
        .iter()
        .map(|point| (point.0 * point.0 + point.1 * point.1).sqrt())
        .fold(0.0, f64::max);
    if spread <= 1e-9 {
        let count = points.len().max(1) as f64;
        for (index, point) in points.iter_mut().enumerate() {
            let angle = index as f64 * std::f64::consts::TAU / count;
            *point = (angle.cos(), angle.sin());
        }
    }
}

fn centroid(points: impl Iterator<Item = (f64, f64)>) -> (f64, f64) {
    let mut count = 0.0;
    let mut x = 0.0;
    let mut y = 0.0;
    for point in points {
        count += 1.0;
        x += point.0;
        y += point.1;
    }
    if count > 0.0 {
        (x / count, y / count)
    } else {
        (0.0, 0.0)
    }
}

fn finite_positive(value: Option<f64>, fallback: f64) -> f64 {
    match value {
        Some(value) if value.is_finite() && value > 0.0 => value,
        _ => fallback,
    }
}

fn dot(left: &[f64], right: &[f64]) -> f64 {
    left.iter().zip(right.iter()).map(|(a, b)| a * b).sum()
}

fn orthogonalize(vector: &mut [f64], basis: Option<&[f64]>) {
    let Some(basis) = basis else {
        return;
    };
    let projection = dot(vector, basis);
    for (value, basis_value) in vector.iter_mut().zip(basis.iter()) {
        *value -= projection * basis_value;
    }
}

fn normalize_vector(vector: &mut [f64]) {
    let norm = vector_norm(vector);
    if norm <= 1e-9 {
        return;
    }
    for value in vector {
        *value /= norm;
    }
}

fn vector_norm(vector: &[f64]) -> f64 {
    vector.iter().map(|value| value * value).sum::<f64>().sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(nodes: Vec<PivotMdsNode>, edges: Vec<PivotMdsEdge>) -> PivotMdsInput {
        PivotMdsInput {
            nodes,
            edges,
            pivot_count: Some(3),
            edge_length: Some(100.0),
        }
    }

    fn node(id: &str, x: f64, y: f64, fixed: bool) -> PivotMdsNode {
        PivotMdsNode {
            id: id.to_string(),
            x,
            y,
            fixed,
        }
    }

    fn edge(source: &str, target: &str) -> PivotMdsEdge {
        PivotMdsEdge {
            source: source.to_string(),
            target: target.to_string(),
        }
    }

    #[test]
    fn returns_finite_positions_for_a_chain() {
        let positions = seed_positions(&input(
            vec![
                node("a", 0.0, 0.0, false),
                node("b", 1.0, 0.0, false),
                node("c", 2.0, 0.0, false),
                node("d", 3.0, 0.0, false),
            ],
            vec![edge("a", "b"), edge("b", "c"), edge("c", "d")],
        ));

        assert_eq!(positions.len(), 4);
        assert!(positions
            .iter()
            .all(|position| position.x.is_finite() && position.y.is_finite()));
        assert!(positions[0].x < positions[3].x || positions[0].y < positions[3].y);
    }

    #[test]
    fn keeps_fixed_nodes_exactly_pinned() {
        let positions = seed_positions(&input(
            vec![
                node("a", 10.0, 20.0, true),
                node("b", 100.0, 20.0, false),
                node("c", 200.0, 20.0, true),
            ],
            vec![edge("a", "b"), edge("b", "c")],
        ));

        assert_eq!(positions[0], PivotMdsPosition { id: "a".to_string(), x: 10.0, y: 20.0 });
        assert_eq!(positions[2], PivotMdsPosition { id: "c".to_string(), x: 200.0, y: 20.0 });
    }
}
