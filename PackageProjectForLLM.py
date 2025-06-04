import os
import subprocess  # Import subprocess for running shell commands


def package_project(project_dir, file_extension=".py"):
    # Execute the 'tree .' command and print the output

    tree_output = subprocess.check_output(['tree', project_dir])
    out = tree_output.decode('utf-8')

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
