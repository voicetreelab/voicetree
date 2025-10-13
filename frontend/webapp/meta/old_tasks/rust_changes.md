# Rust WASM Tidy Library - Required Changes

Based on the compiled WASM and system reminders, here are all the major changes needed to recreate your modifications to the tidy library.

## 1. Remove tinyset dependency

**File:** `tidy/rust/crates/tidy-tree/Cargo.toml`

```diff
[dependencies]
num = "0.4.0"
-tinyset = "0.4.16"
```

## 2. Replace tinyset with BTreeSet

**File:** `tidy/rust/crates/tidy-tree/src/layout/tidy_layout.rs`

```diff
-use std::{collections::HashSet, hash::BuildHasher, ptr::NonNull, thread::panicking};
+use std::{collections::{BTreeSet, HashSet}, hash::BuildHasher, ptr::NonNull, thread::panicking};

 use num::Float;
-use tinyset::SetUsize;
```

## 3. Add subtree_size field to Node

**File:** `tidy/rust/crates/tidy-tree/src/node.rs`

Add to Node struct:
```rust
pub struct Node {
    pub id: usize,
    pub width: Coord,
    pub height: Coord,
    pub x: Coord,
    pub y: Coord,
    pub relative_x: Coord,
    pub relative_y: Coord,
    pub bbox: BoundingBox,
    pub parent: Option<NonNull<Node>>,
    pub children: Vec<Box<Node>>,
    pub tidy: Option<Box<TidyData>>,
+   /// Total number of nodes in this subtree (including self)
+   pub subtree_size: usize,
}
```

Update Clone impl:
```rust
impl Clone for Node {
    fn clone(&self) -> Self {
        let mut root = Self {
            // ... other fields ...
+           subtree_size: self.subtree_size,
        };
```

Update Default impl:
```rust
impl Default for Node {
    fn default() -> Self {
        Self {
            // ... other fields ...
+           subtree_size: 1,
        }
    }
}
```

Update new() method:
```rust
pub fn new(id: usize, width: Coord, height: Coord) -> Self {
    Node {
        // ... other fields ...
+       subtree_size: 1,
    }
}
```

## 4. Update first_walk to track subtree_size

**File:** `tidy/rust/crates/tidy-tree/src/layout/tidy_layout.rs`

```rust
fn first_walk(&mut self, node: &mut Node) {
    if node.children.is_empty() {
        node.set_extreme();
+       node.subtree_size = 1;
        return;
    }

+   let mut total_size = 1; // count self
    self.first_walk(node.children.first_mut().unwrap());
+   total_size += node.children[0].subtree_size;
+
    let mut y_list = LinkedYList::new(0, node.children[0].extreme_right().bottom());
    for i in 1..node.children.len() {
        let current_child = node.children.get_mut(i).unwrap();
        self.first_walk(current_child);
+       total_size += current_child.subtree_size;
        let max_y = current_child.extreme_left().bottom();
        y_list = self.separate(node, i, y_list);
        y_list = y_list.update(i, max_y);
    }

    node.position_root();
    node.set_extreme();
+   node.subtree_size = total_size;
}
```

## 5. Update first_walk_with_filter to track subtree_size

**File:** `tidy/rust/crates/tidy-tree/src/layout/tidy_layout.rs`

```diff
-fn first_walk_with_filter(&mut self, node: &mut Node, set: &SetUsize) {
-    if !set.contains(node as *const _ as usize) {
+fn first_walk_with_filter(&mut self, node: &mut Node, set: &BTreeSet<usize>) {
+    if !set.contains(&(node as *const _ as usize)) {
        invalidate_extreme_thread(node);
        return;
    }

    if node.children.is_empty() {
        node.set_extreme();
+       node.subtree_size = 1;
        return;
    }

+   let mut total_size = 1; // count self
    self.first_walk_with_filter(node.children.first_mut().unwrap(), set);
+   total_size += node.children[0].subtree_size;
+
    let mut y_list = LinkedYList::new(0, node.children[0].extreme_right().bottom());
    for i in 1..node.children.len() {
        let current_child = node.children.get_mut(i).unwrap();
        current_child.tidy_mut().modifier_to_subtree = -current_child.relative_x;
        self.first_walk_with_filter(current_child, set);
+       total_size += current_child.subtree_size;
        let max_y = current_child.extreme_left().bottom();
        y_list = self.separate(node, i, y_list);
        y_list = y_list.update(i, max_y);
    }

    node.position_root();
    node.set_extreme();
+   node.subtree_size = total_size;
}
```

## 6. Update second_walk_with_filter signature

**File:** `tidy/rust/crates/tidy-tree/src/layout/tidy_layout.rs`

```diff
-fn second_walk_with_filter(&mut self, node: &mut Node, mut mod_sum: Coord, set: &SetUsize) {
+fn second_walk_with_filter(&mut self, node: &mut Node, mut mod_sum: Coord, set: &BTreeSet<usize>) {
    mod_sum += node.tidy_mut().modifier_to_subtree;
    let new_x = node.relative_x + mod_sum;
-   if (new_x - node.x).abs() < 1e-8 && !set.contains(node as *const _ as usize) {
+   if (new_x - node.x).abs() < 1e-8 && !set.contains(&(node as *const _ as usize)) {
        return;
    }
```

## 7. Update partial_layout to use BTreeSet

**File:** `tidy/rust/crates/tidy-tree/src/layout/tidy_layout.rs`

```diff
-   let mut set: SetUsize = SetUsize::new();
+   let mut set: BTreeSet<usize> = BTreeSet::new();
    for node in changed.iter() {
        set.insert(node.as_ptr() as usize);
        let mut node = unsafe { &mut *node.as_ptr() };
        while node.parent.is_some() {
            invalidate_extreme_thread(node);
            set.insert(node.parent.unwrap().as_ptr() as usize);
            node = node.parent_mut().unwrap();
        }
    }
```

## 8. Better Option handling for extreme_left/extreme_right

**File:** `tidy/rust/crates/tidy-tree/src/layout/tidy_layout.rs`

In `set_extreme()` method, improve the handling to account for None cases:

```rust
fn set_extreme(&mut self) {
    let self_ptr: NonNull<Node> = self.into();
    let tidy = self.tidy.as_mut().unwrap();
    if self.children.is_empty() {
        tidy.extreme_left = Some(self_ptr);
        tidy.extreme_right = Some(self_ptr);
        tidy.modifier_extreme_left = 0.;
        tidy.modifier_extreme_right = 0.;
    } else {
        let first_child = self.children.first().unwrap();
        let first_tidy = first_child.tidy.as_ref().unwrap();
        let first_ptr: NonNull<Node> = (&**first_child).into();
        let (extreme_left_ptr, extreme_left_modifier) = if let Some(extreme) = first_tidy.extreme_left {
            (extreme, first_tidy.modifier_extreme_left)
        } else {
            (first_ptr, 0.)
        };
        tidy.extreme_left = Some(extreme_left_ptr);
        tidy.modifier_extreme_left = first_tidy.modifier_to_subtree + extreme_left_modifier;

        let last_child = self.children.last().unwrap();
        let last_tidy = last_child.tidy.as_ref().unwrap();
        let last_ptr: NonNull<Node> = (&**last_child).into();
        let (extreme_right_ptr, extreme_right_modifier) = if let Some(extreme) = last_tidy.extreme_right {
            (extreme, last_tidy.modifier_extreme_right)
        } else {
            (last_ptr, 0.)
        };
        tidy.extreme_right = Some(extreme_right_ptr);
        tidy.modifier_extreme_right = last_tidy.modifier_to_subtree + extreme_right_modifier;
    }
}
```

## 9. Radialize children function (UNCERTAIN - mentioned but not in decompiled WASM)

**File:** `tidy/rust/crates/tidy-tree/src/layout/tidy_layout.rs`

You mentioned a `radialize_children` function that distributes children radially. This might have been:

```rust
fn radialize_children(&self, node: &mut Node) {
    if node.children.is_empty() {
        return;
    }

    let n = node.children.len();
    let base_dy = node.height + self.parent_child_margin;

    // Robust left/right split
    let mut left_indices = Vec::new();
    let mut right_indices = Vec::new();

    for (i, child) in node.children.iter().enumerate() {
        if child.relative_x >= 0.0 {
            right_indices.push(i);
        } else {
            left_indices.push(i);
        }
    }

    // TODO: Add radial distribution logic here
}
```

**NOTE:** This function was mentioned but I don't have enough details to recreate it fully. You'll need to remember what it did.

## Summary

The main changes are:
1. **Remove tinyset** - Replace with stdlib BTreeSet
2. **Add subtree_size tracking** - Track total nodes in each subtree
3. **Better Option handling** - Safer unwrapping of extreme_left/extreme_right
4. **Update all SetUsize references** - Change to `BTreeSet<usize>` with proper contains() calls

## Build Command

After making these changes:
```bash
cd tidy
npm run build:wasm
```

This will regenerate the WASM binary at `tidy/wasm_dist/wasm_bg.wasm`, which then needs to be copied to `src/graph-core/wasm-tidy/`.
