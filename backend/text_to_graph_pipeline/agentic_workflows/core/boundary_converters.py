"""
Boundary conversion utilities for converting between LangGraph dicts and Pydantic models.

This module implements the "Boundary Conversion" pattern to handle the impedance mismatch
between LangGraph (which requires dicts) and our business logic (which uses Pydantic models).
"""

import logging
from typing import Any
from typing import Dict
from typing import List
from typing import Optional
from typing import Type
from typing import TypeVar

from pydantic import BaseModel
from pydantic import ValidationError

T = TypeVar('T', bound=BaseModel)


def dicts_to_models(
    data: Optional[List[Dict[str, Any]]], 
    model_class: Type[T],
    field_name: str = "data"
) -> List[T]:
    """
    Convert a list of dictionaries to a list of Pydantic models.
    
    Args:
        data: List of dictionaries to convert (can be None)
        model_class: The Pydantic model class to convert to
        field_name: Name of the field for error messages
        
    Returns:
        List of validated Pydantic model instances
        
    Raises:
        ValueError: If validation fails
    """
    if not data:
        return []
    
    try:
        return [model_class.model_validate(item) for item in data]
    except ValidationError as e:
        logging.error(f"Validation error converting {field_name}: {e}")
        raise ValueError(f"Invalid {field_name} data: {e}")


def models_to_dicts(models: List[BaseModel]) -> List[Dict[str, Any]]:
    """
    Convert a list of Pydantic models to a list of dictionaries.
    
    Args:
        models: List of Pydantic model instances
        
    Returns:
        List of dictionaries suitable for LangGraph state
    """
    return [model.model_dump() for model in models]


def dict_to_model(
    data: Optional[Dict[str, Any]], 
    model_class: Type[T],
    field_name: str = "data"
) -> Optional[T]:
    """
    Convert a single dictionary to a Pydantic model.
    
    Args:
        data: Dictionary to convert (can be None)
        model_class: The Pydantic model class to convert to
        field_name: Name of the field for error messages
        
    Returns:
        Validated Pydantic model instance or None if data is None
        
    Raises:
        ValueError: If validation fails
    """
    if not data:
        return None
    
    try:
        return model_class.model_validate(data)
    except ValidationError as e:
        logging.error(f"Validation error converting {field_name}: {e}")
        raise ValueError(f"Invalid {field_name} data: {e}")


def model_to_dict(model: Optional[BaseModel]) -> Optional[Dict[str, Any]]:
    """
    Convert a single Pydantic model to a dictionary.
    
    Args:
        model: Pydantic model instance (can be None)
        
    Returns:
        Dictionary suitable for LangGraph state or None if model is None
    """
    if not model:
        return None
    
    return model.model_dump()