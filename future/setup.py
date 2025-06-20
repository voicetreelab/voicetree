from setuptools import setup, find_packages

setup(
    name="voicetree",
    version="0.1.0",
    packages=find_packages(),
    install_requires=[
        "setuptools",
        # "pyaudio",  # Optional: only needed for live microphone recording
        "SpeechRecognition",
        "torch~=2.2.0",
        "numpy~=1.26.4",
        "google~=3.0.0",
        "nltk~=3.8.1",
        "rake-nltk",
        "pytest>=7.0.0",
        "pytest-asyncio",
        "google-generativeai",
        "openai",
        "aider-chat>=0.84.0",
    ],
) 