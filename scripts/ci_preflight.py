#!/usr/bin/env python3
"""
CI/CD Pre-flight Validation Script
==================================

Validates all dependencies and environment setup before running any tests.
This prevents the cascade of errors and provides clear, actionable diagnostics.
"""

import os
import sys
import subprocess
import json
from pathlib import Path
from typing import Dict, List, Tuple, Optional
import importlib.util


class CICDValidationResult:
    """Result of a validation check"""
    def __init__(self, check_name: str, passed: bool, message: str, fix_suggestion: str = ""):
        self.check_name = check_name
        self.passed = passed
        self.message = message
        self.fix_suggestion = fix_suggestion


class CICDValidator:
    """Pre-flight validation for CI/CD pipeline"""
    
    def __init__(self):
        self.results: List[CICDValidationResult] = []
        self.critical_failures = 0
        self.warnings = 0
        
    def add_result(self, result: CICDValidationResult):
        """Add a validation result"""
        self.results.append(result)
        if not result.passed:
            self.critical_failures += 1
    
    def add_warning(self, check_name: str, message: str):
        """Add a warning (non-blocking)"""
        result = CICDValidationResult(check_name, True, f"⚠️  {message}")
        self.results.append(result)
        self.warnings += 1
    
    def validate_python_environment(self) -> bool:
        """Validate Python version and virtual environment"""
        # Check Python version
        if sys.version_info < (3, 9):
            self.add_result(CICDValidationResult(
                "python_version",
                False,
                f"❌ Python {sys.version_info.major}.{sys.version_info.minor} is too old",
                "Install Python 3.9 or newer"
            ))
            return False
        
        self.add_result(CICDValidationResult(
            "python_version",
            True,
            f"✅ Python {sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
        ))
        
        # Check virtual environment (recommended but not required in CI)
        venv_path = os.environ.get('VIRTUAL_ENV')
        if venv_path:
            self.add_result(CICDValidationResult(
                "virtual_env",
                True,
                f"✅ Virtual environment: {venv_path}"
            ))
        else:
            self.add_warning("virtual_env", "No virtual environment detected (OK in CI)")
        
        return True
    
    def validate_environment_variables(self) -> bool:
        """Validate required environment variables"""
        required_vars = {
            "GOOGLE_API_KEY": "Google Gemini API access"
        }
        
        all_passed = True
        for var_name, description in required_vars.items():
            value = os.environ.get(var_name)
            if not value:
                self.add_result(CICDValidationResult(
                    f"env_var_{var_name.lower()}",
                    False,
                    f"❌ {var_name} not set ({description})",
                    f"Set {var_name} environment variable or add to repository secrets"
                ))
                all_passed = False
            else:
                # Don't log the actual key value for security
                masked_value = f"{value[:8]}..." if len(value) > 8 else "***"
                self.add_result(CICDValidationResult(
                    f"env_var_{var_name.lower()}",
                    True,
                    f"✅ {var_name} configured ({masked_value})"
                ))
        
        return all_passed
    
    def validate_package_installation(self) -> bool:
        """Validate that all required packages are installed"""
        required_packages = {
            "google.generativeai": "Google Gemini API client",
            "pytest": "Testing framework",
            "pydantic": "Data validation",
            "langgraph": "Workflow system"
        }
        
        all_passed = True
        for package_name, description in required_packages.items():
            try:
                spec = importlib.util.find_spec(package_name)
                if spec is not None:
                    self.add_result(CICDValidationResult(
                        f"package_{package_name.replace('.', '_')}",
                        True,
                        f"✅ {package_name} installed"
                    ))
                else:
                    self.add_result(CICDValidationResult(
                        f"package_{package_name.replace('.', '_')}",
                        False,
                        f"❌ {package_name} not found ({description})",
                        f"pip install {package_name}"
                    ))
                    all_passed = False
            except Exception as e:
                self.add_result(CICDValidationResult(
                    f"package_{package_name.replace('.', '_')}",
                    False,
                    f"❌ Error checking {package_name}: {e}",
                    f"pip install {package_name}"
                ))
                all_passed = False
        
        return all_passed
    
    def validate_api_connectivity(self) -> bool:
        """Test API connectivity with minimal request"""
        try:
            import google.generativeai as genai
            
            # Configure API
            api_key = os.environ.get("GOOGLE_API_KEY")
            if not api_key:
                self.add_result(CICDValidationResult(
                    "api_connectivity",
                    False,
                    "❌ Cannot test API - no API key",
                    "Set GOOGLE_API_KEY environment variable"
                ))
                return False
            
            genai.configure(api_key=api_key)
            
            # Test with minimal request
            model = genai.GenerativeModel('gemini-2.0-flash')
            response = model.generate_content(
                "Say 'OK'",
                generation_config=genai.GenerationConfig(max_output_tokens=5)
            )
            
            if response and response.text:
                self.add_result(CICDValidationResult(
                    "api_connectivity",
                    True,
                    f"✅ API connectivity confirmed (response: {response.text.strip()})"
                ))
                return True
            else:
                self.add_result(CICDValidationResult(
                    "api_connectivity",
                    False,
                    "❌ API responded but no text received",
                    "Check API key permissions and quota"
                ))
                return False
                
        except ImportError as e:
            self.add_result(CICDValidationResult(
                "api_connectivity",
                False,
                f"❌ Cannot import google.generativeai: {e}",
                "pip install google-generativeai"
            ))
            return False
        except Exception as e:
            error_msg = str(e)
            if "API_KEY_INVALID" in error_msg:
                fix_suggestion = "Check that GOOGLE_API_KEY is valid"
            elif "PERMISSION_DENIED" in error_msg:
                fix_suggestion = "Check API key permissions for Gemini API"
            elif "QUOTA_EXCEEDED" in error_msg:
                fix_suggestion = "API quota exceeded - wait or upgrade plan"
            else:
                fix_suggestion = "Check network connectivity and API status"
            
            self.add_result(CICDValidationResult(
                "api_connectivity",
                False,
                f"❌ API connectivity failed: {error_msg}",
                fix_suggestion
            ))
            return False
    
    def validate_project_structure(self) -> bool:
        """Validate expected project structure"""
        required_files = [
            "requirements.txt",
            "backend/agentic_workflows/main.py",
            "backend/agentic_workflows/infrastructure/llm_integration.py",
            ".github/workflows/test-agentic-workflows.yml"
        ]
        
        all_passed = True
        for file_path in required_files:
            path = Path(file_path)
            if path.exists():
                self.add_result(CICDValidationResult(
                    f"file_{file_path.replace('/', '_').replace('.', '_')}",
                    True,
                    f"✅ {file_path} exists"
                ))
            else:
                self.add_result(CICDValidationResult(
                    f"file_{file_path.replace('/', '_').replace('.', '_')}",
                    False,
                    f"❌ {file_path} missing",
                    f"Check project structure - expected file at {file_path}"
                ))
                all_passed = False
        
        return all_passed
    
    def run_all_validations(self) -> bool:
        """Run all validation checks"""
        print("🔍 CI/CD Pre-flight Validation")
        print("=" * 50)
        
        validation_steps = [
            ("Python Environment", self.validate_python_environment),
            ("Environment Variables", self.validate_environment_variables),
            ("Package Installation", self.validate_package_installation),
            ("Project Structure", self.validate_project_structure),
            ("API Connectivity", self.validate_api_connectivity),
        ]
        
        all_passed = True
        for step_name, validator in validation_steps:
            print(f"\n📋 {step_name}:")
            try:
                step_passed = validator()
                if not step_passed:
                    all_passed = False
            except Exception as e:
                print(f"   ❌ Validation step failed: {e}")
                all_passed = False
        
        return all_passed
    
    def print_summary(self):
        """Print validation summary"""
        print("\n" + "=" * 70)
        print("📊 VALIDATION SUMMARY")
        print("=" * 70)
        
        # Print all results
        for result in self.results:
            print(f"   {result.message}")
            if not result.passed and result.fix_suggestion:
                print(f"      💡 Fix: {result.fix_suggestion}")
        
        # Overall status
        print(f"\n🎯 Results: {len(self.results) - self.critical_failures} passed, {self.critical_failures} failed, {self.warnings} warnings")
        
        if self.critical_failures == 0:
            print("✅ ALL VALIDATIONS PASSED - CI/CD can proceed")
            return True
        else:
            print("❌ VALIDATION FAILURES - Fix issues before running tests")
            return False


def main():
    """Main entry point"""
    validator = CICDValidator()
    
    try:
        success = validator.run_all_validations()
        final_success = validator.print_summary()
        
        if success and final_success:
            print("\n🚀 Pre-flight validation successful - ready for testing!")
            sys.exit(0)
        else:
            print("\n🚨 Pre-flight validation failed - please fix issues above")
            sys.exit(1)
            
    except KeyboardInterrupt:
        print("\n⚠️ Validation interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n💥 Unexpected error during validation: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main() 