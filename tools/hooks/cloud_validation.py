#!/usr/bin/env python3
"""
Cloud validation hook for VoiceTree Claude settings.
Validates tool usage in cloud environments for security and compliance.
"""

import os
import sys
import json
import re
from pathlib import Path

def is_cloud_environment():
    """Check if we're running in a cloud environment."""
    cloud_indicators = [
        'CLOUD_ENV',
        'AWS_EXECUTION_ENV', 
        'GOOGLE_CLOUD_PROJECT',
        'AZURE_FUNCTIONS_ENVIRONMENT'
    ]
    return any(os.getenv(var) for var in cloud_indicators)

def validate_command(command):
    """Validate commands for cloud safety."""
    dangerous_patterns = [
        r'rm\s+-rf\s+/',  # Dangerous rm commands
        r'sudo\s+',       # Sudo commands
        r'curl.*\|.*sh',  # Pipe to shell
        r'wget.*\|.*sh',  # Pipe to shell
        r'>/etc/',        # Writing to system directories
    ]
    
    for pattern in dangerous_patterns:
        if re.search(pattern, command, re.IGNORECASE):
            return False, f"Potentially dangerous command pattern detected: {pattern}"
    
    return True, "Command validated"

def main():
    """Main validation logic."""
    try:
        # Read hook input from stdin if available
        if not sys.stdin.isatty():
            hook_data = json.loads(sys.stdin.read())
            tool_name = hook_data.get('tool', {}).get('name', '')
            tool_params = hook_data.get('tool', {}).get('parameters', {})
            
            # Only validate in cloud environments
            if not is_cloud_environment():
                print(json.dumps({"allow": True, "message": "Local environment - validation skipped"}))
                return
            
            # Validate Bash commands
            if tool_name == 'Bash':
                command = tool_params.get('command', '')
                is_safe, message = validate_command(command)
                print(json.dumps({"allow": is_safe, "message": message}))
                return
            
            # Allow other tools by default in cloud
            print(json.dumps({"allow": True, "message": f"Tool {tool_name} allowed"}))
        else:
            # No stdin input, just report status
            print(json.dumps({"allow": True, "message": "Cloud validation hook active"}))
            
    except Exception as e:
        # Fail safe - allow operation but log error
        print(json.dumps({"allow": True, "message": f"Validation error: {str(e)}"}))

if __name__ == "__main__":
    main()