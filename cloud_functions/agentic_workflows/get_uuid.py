"""
Deterministic UUID generation based on machine information.

This module generates a stable UUID for the current machine that remains
consistent across runs but differs between machines. Used for rate limiting
and user identification in cloud function calls.
"""

import uuid
import socket
import platform


def get_user_uuid() -> str:
    """
    Generate a deterministic UUID based on stable machine identifiers.

    The UUID is generated using uuid.uuid5() with a namespace and stable
    machine information (hostname + system + machine + MAC). This ensures:
    - Same UUID on every call from the same machine
    - Different UUIDs for different machines
    - No state storage required

    Returns:
        str: A deterministic UUID string for this machine
    """
    # Use DNS namespace as the base (standard practice for uuid5)
    namespace = uuid.NAMESPACE_DNS

    # Combine stable machine identifiers with fallbacks
    hostname = socket.gethostname() or "unknown-host"
    system = platform.system() or "unknown-system"
    machine = platform.machine() or "unknown-machine"
    mac = uuid.getnode()  # Always returns an integer (random if no MAC available)

    # Create a stable identifier string
    machine_identifier = f"{hostname}.{system}.{machine}.{mac}"

    # Generate deterministic UUID
    return str(uuid.uuid5(namespace, machine_identifier))
