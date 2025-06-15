# Pipeline System Tests

This folder contains integration tests that require the actual `.m4a` audio file and should only be run in CI/CD environments.

## What's in here?

- `test_audio_processing.py` - Tests that process the real `voice_example_test_input.m4a` file
- `test_manual_workflow.py` - Tests file-based workflow as alternative to live recording  
- `test_full_system_integration.py` - Complete end-to-end system tests with real audio
- `voice_example_test_input.m4a` - The actual test audio file

## Running locally

By default, regular `pytest` runs will NOT include these tests since they:
- Take longer to run (audio processing)
- Require the large `.m4a` file
- May require additional system dependencies

## Running in CI/CD

In CI/CD, run these tests with:
```bash
python -m pytest backend/pipeline_system_tests/ -v
```

## Local development

For local development, just run the regular tests:
```bash  
python -m pytest backend/tests/ -v
```

This gives you fast feedback without the overhead of audio processing tests.

## Why this separation?

This approach is much simpler than complex pytest markers and environment detection:
- ✅ Simple folder separation
- ✅ Clear intent (pipeline vs unit tests)
- ✅ Easy to understand and maintain
- ✅ Fast local development workflow
- ✅ Complete CI/CD coverage 