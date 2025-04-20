import json
import argparse # Import argparse for command-line arguments
from typing import Dict, Any, List, Tuple

# --- Function Definition (extract_langflow_core_info remains the same) ---
def extract_langflow_core_info(json_data: Dict[str, Any]) -> str:
    """
    Extracts core prompt information and connections from Langflow JSON data.

    Args:
        json_data: The loaded Langflow workflow JSON as a Python dictionary.

    Returns:
        A string summarizing the core workflow (prompts and their connections)
        suitable for analysis by an LLM.
    """
    # ... (Keep the exact same function content as in your provided code) ...
    if 'data' not in json_data or 'nodes' not in json_data['data'] or 'edges' not in json_data['data']:
        return "Error: Invalid Langflow JSON structure. Missing 'data', 'nodes', or 'edges'."

    nodes = json_data['data']['nodes']
    edges = json_data['data']['edges']

    # --- 1. Extract Node Information (Focus on Prompts and LLMs) ---
    node_info: Dict[str, Dict[str, Any]] = {}
    prompt_nodes: Dict[str, Dict[str, Any]] = {}

    for node_data in nodes:
        try:
            node_id = node_data['data']['id']
            node_type = node_data['data']['type']
            # Use display_name if available and informative, otherwise fallback to type/id
            raw_display_name = node_data['data'].get('display_name', '')
            node_details = node_data['data'].get('node', {})
            template_details = node_details.get('template', {})

            # Create a more descriptive name
            # Handle potential case where id might not have '-'
            id_parts = node_id.split('-')
            short_id = id_parts[1] if len(id_parts) > 1 else node_id
            descriptive_name = raw_display_name if raw_display_name and raw_display_name != node_type else f"{node_type}_{short_id}"

            node_info[node_id] = {
                'id': node_id,
                'type': node_type,
                'name': descriptive_name,
                'prompt': None,
                'model': None # For LLM nodes
            }

            # Extract Prompt Text specifically
            if node_type == 'Prompt':
                # The actual prompt text is nested within template -> template -> value
                prompt_template_field = template_details.get('template', {})
                if isinstance(prompt_template_field, dict) and prompt_template_field.get('_input_type') == 'PromptInput':
                    prompt_text = prompt_template_field.get('value', '').strip()
                    node_info[node_id]['prompt'] = prompt_text
                    prompt_nodes[node_id] = node_info[node_id] # Add to prompt specific dict

            # Extract LLM Model Info (Example for GoogleGenerativeAIModel)
            elif node_type == 'GoogleGenerativeAIModel':
                 model_field = template_details.get('model_name', {})
                 if isinstance(model_field, dict):
                     node_info[node_id]['model'] = model_field.get('value', 'Unknown Model')
            # Add more 'elif' blocks here to extract specific info from other node types if needed

        except KeyError as e:
            print(f"Warning: Skipping node due to missing key {e}. Node data: {node_data.get('data', {}).get('id', 'UNKNOWN_ID')}")
            continue
        except Exception as e:
            print(f"Warning: Error processing node {node_data.get('data', {}).get('id', 'UNKNOWN_ID')}: {e}")
            continue


    # --- 2. Extract and Simplify Connections ---
    connections: List[Tuple[str, str, str, str, str, str]] = [] # (source_id, source_name, source_output, target_id, target_name, target_input)

    for edge in edges:
        try:
            source_id = edge['source']
            target_id = edge['target']

            # Get handle details (output port on source, input port on target)
            source_handle = edge.get('data', {}).get('sourceHandle', {})
            target_handle = edge.get('data', {}).get('targetHandle', {})

            # Extract meaningful names for ports if possible
            source_output_name = source_handle.get('name', 'output') # e.g., 'prompt', 'text_output'
            target_input_name = target_handle.get('fieldName', 'input') # e.g., 'input_value', 'template', 'text'

            # Only record connections involving known nodes
            if source_id in node_info and target_id in node_info:
                 connections.append((
                     source_id,
                     node_info[source_id]['name'],
                     source_output_name,
                     target_id,
                     node_info[target_id]['name'],
                     target_input_name
                 ))

        except KeyError as e:
            print(f"Warning: Skipping edge due to missing key {e}. Edge data: {edge}")
            continue
        except Exception as e:
             print(f"Warning: Error processing edge {edge.get('id', 'UNKNOWN_ID')}: {e}")
             continue

    # --- 3. Format the Output String ---
    output_lines = []
    output_lines.append("Langflow Workflow Core Summary:")
    output_lines.append("===============================")

    output_lines.append("\n--- Prompt Nodes ---")
    if not prompt_nodes:
        output_lines.append("No Prompt nodes found.")
    else:
        sorted_prompt_nodes = sorted(prompt_nodes.items(), key=lambda item: item[1]['name']) # Sort for consistency
        for node_id, info in sorted_prompt_nodes:
            output_lines.append(f"\nNode: {info['name']} (ID: {node_id})")
            output_lines.append("-" * (len(info['name']) + 12))
            output_lines.append("Prompt Text:")
            output_lines.append("```")
            # Indent prompt text slightly for readability
            indented_prompt = "\n".join(["  " + line for line in info['prompt'].splitlines()])
            output_lines.append(indented_prompt if indented_prompt else "  (Prompt text is empty)")
            output_lines.append("```")

    output_lines.append("\n--- Connections ---")
    if not connections:
        output_lines.append("No connections found between processed nodes.")
    else:
        output_lines.append("Format: [Source Node (Output Port)] --> [Target Node (Input Port)]\n")
        # Sort connections for consistent output (optional, but helpful)
        sorted_connections = sorted(connections, key=lambda x: (x[1], x[4])) # Sort by source name, then target name
        for src_id, src_name, src_output, trg_id, trg_name, trg_input in sorted_connections:
             # Highlight connections involving prompts
             is_prompt_related = src_id in prompt_nodes or trg_id in prompt_nodes
             prefix = "* " if is_prompt_related else "- "
             output_lines.append(f"{prefix}[{src_name} ({src_output})] --> [{trg_name} ({trg_input})]")


    output_lines.append("\n--- Other Significant Nodes ---")
    other_nodes = []
    for node_id, info in node_info.items():
         # Define significant node types here
        significant_types = {'GoogleGenerativeAIModel', 'ChatInput', 'ChatOutput', 'AppendAndReadFile', 'TextInput'}
        if node_id not in prompt_nodes and info['type'] in significant_types:
             node_str = f"- {info['name']} (Type: {info['type']}{', Model: ' + info['model'] if info['model'] else ''})"
             other_nodes.append(node_str)

    if other_nodes:
         output_lines.extend(sorted(other_nodes)) # Sort for consistency
    else:
        output_lines.append("No other significant nodes (LLMs, Input/Output, File Ops) detected.")

    output_lines.append("\n===============================")

    return "\n".join(output_lines)


# --- Main Execution Block ---
if __name__ == "__main__":
    # Set up argument parser
    parser = argparse.ArgumentParser(description="Extract core info (prompts, connections) from a Langflow JSON workflow file.")
    parser.add_argument("-i", "--input", required=True, help="Path to the input Langflow JSON file.")
    parser.add_argument("-o", "--output", required=True, help="Path to the output summary text file.")

    # Parse arguments
    args = parser.parse_args()

    input_file_path = args.input
    output_file_path = args.output

    # Load the JSON data from the input file
    try:
        print(f"Reading Langflow JSON from: {input_file_path}")
        with open(input_file_path, "r", encoding="utf-8") as f:
            # Use json.load to read directly from the file object
            data = json.load(f)
    except FileNotFoundError:
        print(f"Error: Input file not found at '{input_file_path}'")
        exit(1) # Exit with an error code
    except json.JSONDecodeError as e:
        print(f"Error decoding JSON from '{input_file_path}': {e}")
        exit(1)
    except Exception as e:
        print(f"An unexpected error occurred while reading the input file: {e}")
        exit(1)

    # Extract the core information using the function
    print("Processing workflow...")
    summary = extract_langflow_core_info(data)

    # Write the summary to the output file
    try:
        print(f"Writing summary to: {output_file_path}")
        with open(output_file_path, "w", encoding="utf-8") as f:
            f.write(summary)
        print("Summary successfully written.")
    except IOError as e:
        print(f"Error writing summary to '{output_file_path}': {e}")
        exit(1)
    except Exception as e:
        print(f"An unexpected error occurred while writing the output file: {e}")
        exit(1)