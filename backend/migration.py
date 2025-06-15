"""
Migration Script for VoiceTree Architecture Cleanup
Helps transition from legacy components to unified architecture
"""

import logging
import warnings
from pathlib import Path
from typing import Dict, Any, Optional

# Configure logging for migrations
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class DeprecationHelper:
    """Helper class for managing deprecation warnings and migrations"""
    
    @staticmethod
    def warn_legacy_import(old_module: str, new_module: str, suggestion: str = None):
        """Issue deprecation warning for legacy imports"""
        message = f"{old_module} is deprecated. Use {new_module} instead."
        if suggestion:
            message += f" {suggestion}"
        
        warnings.warn(
            message,
            DeprecationWarning,
            stacklevel=3
        )
        logger.warning(f"DEPRECATED: {message}")
    
    @staticmethod
    def warn_legacy_method(old_method: str, new_method: str, class_name: str = None):
        """Issue deprecation warning for legacy methods"""
        prefix = f"{class_name}." if class_name else ""
        message = f"{prefix}{old_method}() is deprecated. Use {prefix}{new_method}() instead."
        
        warnings.warn(
            message,
            DeprecationWarning,
            stacklevel=3
        )
        logger.warning(f"DEPRECATED: {message}")


def create_migration_plan() -> Dict[str, Any]:
    """
    Create a comprehensive migration plan for the architectural cleanup
    
    Returns:
        Dictionary with migration steps and recommendations
    """
    return {
        "phase_1_immediate_actions": {
            "description": "Actions to take immediately to start using the new architecture",
            "steps": [
                {
                    "step": "Update imports",
                    "action": "Replace legacy imports with new core imports",
                    "old": "from backend.tree_manager.LLM_engine.LLM_API import generate_async",
                    "new": "from backend.core import LLMClient",
                    "priority": "HIGH"
                },
                {
                    "step": "Update configuration",
                    "action": "Replace settings.py usage with unified config",
                    "old": "import settings; api_key = settings.GOOGLE_API_KEY",
                    "new": "from backend.core import get_config; config = get_config()",
                    "priority": "HIGH"
                },
                {
                    "step": "Replace namedtuples",
                    "action": "Replace NodeAction namedtuples with Pydantic models",
                    "old": "NodeAction = namedtuple('NodeAction', [...])",
                    "new": "from backend.core.models import NodeAction",
                    "priority": "MEDIUM"
                }
            ]
        },
        "phase_2_component_migration": {
            "description": "Migrate to unified components",
            "steps": [
                {
                    "step": "Tree Manager",
                    "action": "Replace multiple tree managers with unified TreeManager",
                    "old": "WorkflowTreeManager, ContextualTreeManager, EnhancedWorkflowTreeManager",
                    "new": "backend.tree.TreeManager",
                    "priority": "HIGH"
                },
                {
                    "step": "LLM Integration",
                    "action": "Replace dual LLM systems with unified LLMClient",
                    "old": "llm_integration.py + LLM_API.py",
                    "new": "backend.core.LLMClient",
                    "priority": "HIGH"
                },
                {
                    "step": "Buffer Management",
                    "action": "Replace multiple buffer implementations",
                    "old": "UnifiedBufferManager + various buffer classes",
                    "new": "backend.tree.BufferManager",
                    "priority": "MEDIUM"
                }
            ]
        },
        "phase_3_cleanup": {
            "description": "Remove legacy code and clean up",
            "steps": [
                {
                    "step": "Remove legacy files",
                    "action": "Delete deprecated files after migration",
                    "files_to_remove": [
                        "backend/tree_manager/LLM_engine/LLM_API.py",
                        "backend/tree_manager/text_to_tree_manager.py",
                        "backend/tree_manager/enhanced_workflow_tree_manager.py",
                        "backend/agentic_workflows/llm_integration.py"
                    ],
                    "priority": "LOW"
                },
                {
                    "step": "Update tests",
                    "action": "Update all tests to use new architecture",
                    "priority": "MEDIUM"
                }
            ]
        },
        "compatibility_layer": {
            "description": "Temporary compatibility for smooth transition",
            "components": [
                "Legacy import wrappers with deprecation warnings",
                "Adapter classes for old interfaces",
                "Configuration migration helpers"
            ]
        }
    }


def check_legacy_usage(project_root: Path) -> Dict[str, Any]:
    """
    Scan codebase for legacy usage patterns
    
    Args:
        project_root: Root directory of the project
        
    Returns:
        Report of legacy usage found
    """
    legacy_patterns = {
        "imports": [
            "from backend.tree_manager.LLM_engine.LLM_API import",
            "from backend.agentic_workflows.llm_integration import",
            "import settings",
            "from backend.tree_manager.workflow_tree_manager import",
        ],
        "classes": [
            "ContextualTreeManager",
            "WorkflowTreeManager", 
            "EnhancedWorkflowTreeManager",
            "VoiceTreePipeline"
        ],
        "functions": [
            "generate_async",
            "call_llm_structured",
            "call_llm"
        ]
    }
    
    findings = {
        "files_scanned": 0,
        "legacy_usage_found": [],
        "recommendations": []
    }
    
    # Scan Python files
    for py_file in project_root.rglob("*.py"):
        if "migration.py" in str(py_file):  # Skip this file
            continue
            
        findings["files_scanned"] += 1
        
        try:
            with open(py_file, 'r', encoding='utf-8') as f:
                content = f.read()
                
            # Check for legacy patterns
            for category, patterns in legacy_patterns.items():
                for pattern in patterns:
                    if pattern in content:
                        findings["legacy_usage_found"].append({
                            "file": str(py_file.relative_to(project_root)),
                            "category": category,
                            "pattern": pattern,
                            "line_count": content.count(pattern)
                        })
                        
        except Exception as e:
            logger.warning(f"Could not scan {py_file}: {e}")
    
    # Generate recommendations
    if findings["legacy_usage_found"]:
        findings["recommendations"] = [
            "Run migration plan phase 1 immediately",
            "Update imports to use new core modules",
            "Replace legacy classes with unified implementations",
            "Add deprecation warnings during transition period"
        ]
    else:
        findings["recommendations"] = [
            "Codebase appears to be using modern architecture",
            "Consider running cleanup phase to remove legacy files"
        ]
    
    return findings


def create_compatibility_layer():
    """
    Create compatibility layer files for smooth transition
    """
    
    # Legacy LLM API compatibility
    llm_api_compat = '''"""
DEPRECATED: Legacy LLM API compatibility layer
This module is deprecated. Use backend.core.LLMClient instead.
"""

import warnings
from backend.core import LLMClient, get_config
from backend.migration import DeprecationHelper

# Issue deprecation warning
DeprecationHelper.warn_legacy_import(
    "backend.tree_manager.LLM_engine.LLM_API",
    "backend.core.LLMClient",
    "This compatibility layer will be removed in a future version."
)

# Legacy compatibility functions
async def generate_async(task, prompt):
    """
    DEPRECATED: Legacy compatibility function
    Use LLMClient.call_text() instead
    """
    DeprecationHelper.warn_legacy_method("generate_async", "LLMClient.call_text")
    
    config = get_config()
    client = LLMClient(config.llm)
    return await client.call_text(prompt)
'''
    
    # Save compatibility layer
    compat_file = Path("backend/tree_manager/LLM_engine/LLM_API_compat.py")
    compat_file.parent.mkdir(parents=True, exist_ok=True)
    
    with open(compat_file, 'w') as f:
        f.write(llm_api_compat)
    
    logger.info(f"Created compatibility layer: {compat_file}")


def run_migration_check(project_root: Optional[Path] = None) -> None:
    """
    Run complete migration check and provide recommendations
    
    Args:
        project_root: Root directory of project (defaults to current working directory)
    """
    if project_root is None:
        project_root = Path.cwd()
    
    logger.info("🔍 Running VoiceTree Architecture Migration Check")
    logger.info("=" * 60)
    
    # Generate migration plan
    plan = create_migration_plan()
    logger.info("📋 Migration Plan Generated")
    
    # Check for legacy usage
    logger.info("🔎 Scanning codebase for legacy usage...")
    findings = check_legacy_usage(project_root)
    
    logger.info(f"📊 Scan Results:")
    logger.info(f"   Files scanned: {findings['files_scanned']}")
    logger.info(f"   Legacy usage instances: {len(findings['legacy_usage_found'])}")
    
    # Report findings
    if findings["legacy_usage_found"]:
        logger.warning("⚠️  Legacy usage found:")
        for finding in findings["legacy_usage_found"][:10]:  # Show first 10
            logger.warning(f"   {finding['file']}: {finding['pattern']} ({finding['line_count']} times)")
        
        if len(findings["legacy_usage_found"]) > 10:
            logger.warning(f"   ... and {len(findings['legacy_usage_found']) - 10} more")
    else:
        logger.info("✅ No legacy usage patterns detected")
    
    # Provide recommendations
    logger.info("💡 Recommendations:")
    for rec in findings["recommendations"]:
        logger.info(f"   • {rec}")
    
    # Show next steps
    logger.info("\n🚀 Next Steps:")
    logger.info("   1. Review the migration plan above")
    logger.info("   2. Start with Phase 1 (immediate actions)")
    logger.info("   3. Use new imports: from backend.core import get_config, LLMClient")
    logger.info("   4. Replace tree managers: from backend.tree import TreeManager")
    logger.info("   5. Run tests to ensure compatibility")
    
    logger.info("\n" + "=" * 60)
    logger.info("Migration check completed! 🎉")


if __name__ == "__main__":
    # Run migration check when script is executed directly
    run_migration_check() 