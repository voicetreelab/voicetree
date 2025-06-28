import os
import subprocess  # Import subprocess for running shell commands


def package_project(project_dir, file_extension=".py"):
    # Try to execute the 'tree' command, fallback to listing files if not available
    try:
        tree_output = subprocess.check_output(['tree', project_dir])
        out = tree_output.decode('utf-8')
    except (subprocess.CalledProcessError, FileNotFoundError):
        # Fallback: create a simple file listing
        out = f"Directory structure of {project_dir}:\n"
        for root, dirs, files in os.walk(project_dir):
            level = root.replace(project_dir, '').count(os.sep)
            indent = ' ' * 2 * level
            out += f"{indent}{os.path.basename(root)}/\n"
            subindent = ' ' * 2 * (level + 1)
            for file in files:
                if file.endswith(file_extension):
                    out += f"{subindent}{file}\n"
        out += "\n"

    for root, dirs, files in os.walk(project_dir):
        dirs[:] = [d for d in dirs if not (d.startswith('.') or d.startswith("__pycache"))]
        for file in files:
            if file.endswith(file_extension):
                file_path = os.path.join(root, file)
                rel_path = os.path.relpath(file_path, project_dir)
                with open(file_path, 'r') as f:
                    content = f.read()
                out += (f"===== {rel_path} =====\n")
                out += (content + "\n")

    return out

if __name__ == "__main__":
    print(package_project("/backend/tree_manager"))
