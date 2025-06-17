"""
Workflow Visualizer - Tools for visualizing and understanding the workflow
"""

from typing import Dict, Any, List, Optional
from pathlib import Path
import json

try:
    from ..graph_definition import (
        get_workflow_definition,
        visualize_workflow
    )
except ImportError:
    from backend.agentic_workflows.graph_definition import (
        get_workflow_definition,
        visualize_workflow
    )


class WorkflowVisualizer:
    """
    Provides visualization and analysis tools for the workflow
    """
    
    def __init__(self):
        self.definition = get_workflow_definition()
    
    def generate_mermaid_diagram(self) -> str:
        """Generate a Mermaid diagram of the workflow"""
        return visualize_workflow()
    
    def generate_html_visualization(self, output_path: Optional[Path] = None) -> str:
        """
        Generate an HTML file with an interactive workflow visualization
        
        Args:
            output_path: Optional path to save the HTML file
            
        Returns:
            HTML content as string
        """
        mermaid_diagram = self.generate_mermaid_diagram()
        
        html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <title>VoiceTree Workflow Visualization</title>
    <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
    <style>
        body {{
            font-family: Arial, sans-serif;
            margin: 20px;
            background-color: #f5f5f5;
        }}
        .container {{
            max-width: 1200px;
            margin: 0 auto;
            background-color: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }}
        h1 {{
            color: #333;
            text-align: center;
        }}
        .mermaid {{
            text-align: center;
            margin: 20px 0;
        }}
        .stage-info {{
            margin-top: 30px;
        }}
        .stage {{
            background-color: #f9f9f9;
            border: 1px solid #ddd;
            border-radius: 4px;
            padding: 15px;
            margin-bottom: 15px;
        }}
        .stage h3 {{
            margin-top: 0;
            color: #555;
        }}
        .stage-details {{
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            margin-top: 10px;
        }}
        .detail-item {{
            font-size: 14px;
        }}
        .detail-label {{
            font-weight: bold;
            color: #666;
        }}
    </style>
</head>
<body>
    <div class="container">
        <h1>VoiceTree Workflow Visualization</h1>
        
        <div class="mermaid">
{mermaid_diagram}
        </div>
        
        <div class="stage-info">
            <h2>Workflow Stages</h2>
            {self._generate_stage_details_html()}
        </div>
    </div>
    
    <script>
        mermaid.initialize({{ startOnLoad: true }});
    </script>
</body>
</html>
"""
        
        if output_path:
            output_path.write_text(html_content)
        
        return html_content
    
    def _generate_stage_details_html(self) -> str:
        """Generate HTML for stage details"""
        html_parts = []
        
        for stage in self.definition["stages"]:
            html_parts.append(f"""
            <div class="stage">
                <h3>{stage['name']}</h3>
                <p>{stage['description']}</p>
                <div class="stage-details">
                    <div class="detail-item">
                        <span class="detail-label">Stage ID:</span> {stage['id']}
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Prompt File:</span> {stage['prompt']}
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Input Keys:</span> {', '.join(stage['input_keys'])}
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Output Key:</span> {stage['output_key']}
                    </div>
                </div>
            </div>
            """)
        
        return "\n".join(html_parts)
    
    def analyze_workflow_complexity(self) -> Dict[str, Any]:
        """
        Analyze the complexity of the workflow
        
        Returns:
            Dictionary with complexity metrics
        """
        stages = self.definition["stages"]
        transitions = self.definition["transitions"]
        
        # Calculate various metrics
        total_stages = len(stages)
        total_transitions = len(transitions)
        
        # Find stages with multiple inputs
        multi_input_stages = [
            stage for stage in stages 
            if len(stage["input_keys"]) > 1
        ]
        
        # Calculate average inputs per stage
        total_inputs = sum(len(stage["input_keys"]) for stage in stages)
        avg_inputs = total_inputs / total_stages if total_stages > 0 else 0
        
        # Find potential bottlenecks (stages that many others depend on)
        stage_dependencies = {}
        for source, target in transitions:
            if target != "END":
                stage_dependencies[target] = stage_dependencies.get(target, 0) + 1
        
        bottlenecks = [
            stage for stage, deps in stage_dependencies.items() 
            if deps > 1
        ]
        
        return {
            "total_stages": total_stages,
            "total_transitions": total_transitions,
            "multi_input_stages": len(multi_input_stages),
            "average_inputs_per_stage": round(avg_inputs, 2),
            "potential_bottlenecks": bottlenecks,
            "is_linear": all(deps <= 1 for deps in stage_dependencies.values()),
            "has_error_handling": len(self.definition["error_transitions"]) > 0
        }
    
    def generate_prompt_summary(self) -> List[Dict[str, Any]]:
        """
        Generate a summary of all prompts used in the workflow
        
        Returns:
            List of prompt summaries
        """
        prompt_summaries = []
        prompts_dir = Path(__file__).parent / "prompts"
        
        for stage in self.definition["stages"]:
            prompt_path = prompts_dir / stage["prompt"]
            
            summary = {
                "stage_id": stage["id"],
                "stage_name": stage["name"],
                "prompt_file": stage["prompt"],
                "exists": prompt_path.exists()
            }
            
            if prompt_path.exists():
                content = prompt_path.read_text()
                summary["size_bytes"] = len(content)
                summary["line_count"] = content.count('\n') + 1
                summary["has_placeholders"] = '{' in content and '}' in content
            
            prompt_summaries.append(summary)
        
        return prompt_summaries
    
    def export_workflow_spec(self, output_path: Path) -> None:
        """
        Export the complete workflow specification to a JSON file
        
        Args:
            output_path: Path to save the specification
        """
        spec = {
            "workflow_definition": self.definition,
            "complexity_analysis": self.analyze_workflow_complexity(),
            "prompt_summary": self.generate_prompt_summary(),
            "mermaid_diagram": self.generate_mermaid_diagram()
        }
        
        with open(output_path, 'w') as f:
            json.dump(spec, f, indent=2)


def main():
    """Example usage of the visualizer"""
    visualizer = WorkflowVisualizer()
    
    # Generate and print Mermaid diagram
    print("Workflow Diagram (Mermaid):")
    print(visualizer.generate_mermaid_diagram())
    
    # Analyze complexity
    print("\nWorkflow Complexity Analysis:")
    analysis = visualizer.analyze_workflow_complexity()
    for key, value in analysis.items():
        print(f"  {key}: {value}")
    
    # Generate HTML visualization
    html_path = Path("workflow_visualization.html")
    visualizer.generate_html_visualization(html_path)
    print(f"\nHTML visualization saved to: {html_path}")


def create_workflow_diagram() -> str:
    """
    Create a workflow diagram using Mermaid syntax
    
    Returns:
        Mermaid diagram as string
    """
    visualizer = WorkflowVisualizer()
    return visualizer.generate_mermaid_diagram()


if __name__ == "__main__":
    main() 