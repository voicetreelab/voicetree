import json
from pathlib import Path
from langflow.custom import Component
from langflow.io import (
    MessageTextInput,
    DropdownInput,
    Output,
    StrInput,
)
# Make sure Message is imported
from langflow.schema.message import Message
import traceback # Import traceback for detailed error logging

class AppendAndReadFileComponent(Component): # Renamed class slightly
    display_name = "Append and Read File" # Renamed display name
    description = "Appends text content to a file and outputs the file's full content."
    icon = "file-edit" # Changed icon
    name = "AppendAndReadFile" # Renamed name

    APPEND_FORMAT_CHOICES = ["txt", "json_list", "markdown"]

    inputs = [
        MessageTextInput(
            name="text_to_append",
            display_name="Text to Append",
            info="The text content to append to the file."
        ),
        DropdownInput(
            name="file_format",
            display_name="File Format",
            options=APPEND_FORMAT_CHOICES,
            value="txt",
            info="Select the file format logic for appending.",
        ),
        StrInput(
            name="file_path",
            display_name="File Path (including filename)",
            info="The full file path (including filename and extension).",
            value="./appended_output.txt",
        ),
        StrInput(
            name="delimiter",
            display_name="Delimiter (for txt/md)",
            info="String to insert *before* new text (if file not empty). Default is newline.",
            value="\n",
            advanced=True,
        ),
    ]

    outputs = [
        Output(
            # Updated output description
            name="file_content",
            display_name="File Content",
            method="append_and_read_file", # Changed method name
            info="The full content of the file after appending.",
        ),
    ]


    # Renamed the main method
    def append_and_read_file(self) -> Message:
        """
        Appends content to the file based on format, then reads
        and returns the entire file content as a Message.
        """
        file_format = self.file_format
        file_path = Path(self.file_path).expanduser()
        text_content = self.text_to_append or ""
        delimiter = self.delimiter
        operation_status = "Append operation started." # Initial status

        if not isinstance(text_content, str):
             self.status = "Error: No valid text provided to append."
             return Message(text=self.status) # Return error message

        # Ensure the directory exists
        if not file_path.parent.exists():
            try:
                file_path.parent.mkdir(parents=True, exist_ok=True)
            except Exception as e:
                 error_msg = f"Error creating directory {file_path.parent}: {e}"
                 self.status = error_msg
                 print(f"{error_msg}\n{traceback.format_exc()}") # Log full error
                 return Message(text=error_msg)

        # --- Perform Append Operation ---
        try:
            if file_format == "txt":
                self._append_text(file_path, text_content, delimiter)
                operation_status = f"Text appended successfully to '{file_path}' (txt format)."
            elif file_format == "markdown":
                self._append_text(file_path, text_content, delimiter)
                operation_status = f"Text appended successfully to '{file_path}' (md format)."
            elif file_format == "json_list":
                self._append_json_list(file_path, text_content)
                operation_status = f"Item appended successfully to JSON list in '{file_path}'."
            else:
                # This case should ideally not be reached due to DropdownInput validation
                raise ValueError(f"Unsupported file format selected: {file_format}")

        except Exception as e:
            error_msg = f"Error during append operation for {file_path}: {e}"
            self.status = error_msg
            print(f"{error_msg}\n{traceback.format_exc()}") # Log full error
            return Message(text=error_msg) # Return error message


        # --- Read File Content After Append ---
        try:
             # Check if file exists after append attempt (it should)
            if not file_path.exists():
                 read_error_msg = f"Error: File '{file_path}' not found after append operation."
                 self.status = read_error_msg
                 return Message(text=read_error_msg)

            file_content = file_path.read_text(encoding="utf-8")
            self.status = operation_status # Set status to the success message from append op
            return Message(text=file_content) # Return the full content

        except Exception as e:
            read_error_msg = f"Error reading file '{file_path}' after append: {e}"
            # Keep the append status, but add read error info maybe?
            self.status = f"{operation_status}. However, failed to read file back: {e}"
            print(f"{read_error_msg}\n{traceback.format_exc()}") # Log full error
            # Decide what to return - maybe the error, or empty message?
            return Message(text=f"Error reading file content: {e}")


    def _append_text(self, path: Path, text: str, delimiter: str) -> None: # Returns None on success
        """Appends text to a file, adding a delimiter if the file exists and is not empty."""
        file_existed_and_non_empty = path.exists() and path.stat().st_size > 0
        # Use append mode ('a'), raises exceptions on OS/permission errors
        with path.open("a", encoding="utf-8") as f:
            if file_existed_and_non_empty:
                f.write(delimiter)
            f.write(text)
        # No return needed on success, exception bubbles up on failure


    def _append_json_list(self, path: Path, text_item: str) -> None: # Returns None on success
        """Appends an item to a JSON list within a file."""
        data_list = []
        # Try to read existing data if file exists
        if path.exists() and path.stat().st_size > 0:
            try:
                with path.open("r", encoding="utf-8") as f:
                    existing_data = json.load(f)
                if isinstance(existing_data, list):
                    data_list = existing_data
                else:
                    print(f"Warning: File {path} exists but doesn't contain a JSON list. Starting a new list.")
            except json.JSONDecodeError:
                 print(f"Warning: File {path} exists but is not valid JSON. Starting a new list.")
            # Let other read errors bubble up

        # Append the new text item
        data_list.append(text_item)

        # Write the entire updated list back (overwrite mode 'w')
        # This raises exceptions on OS/permission errors
        with path.open("w", encoding="utf-8") as f:
            json.dump(data_list, f, indent=2)
        # No return needed on success, exception bubbles up on failure