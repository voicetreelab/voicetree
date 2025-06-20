from setuptools import setup, find_packages

setup(
    name="voicetree-poc",
    version="0.1.0",
    packages=find_packages(where="backend"),
    package_dir={"": "backend"},
    python_requires=">=3.8",
    install_requires=[
        "setuptools",
        "pyaudio",
        "SpeechRecognition",
        "torch~=2.2.0",
        "numpy~=1.26.4",
        "google~=3.0.0",
        "nltk~=3.8.1",
        "pytest>=7.0.0",
        "google-generativeai",
        "openai",
    ],
    extras_require={
        "dev": [
            "pytest",
            "pytest-asyncio",
        ]
    },
) 