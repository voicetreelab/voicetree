# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec file for VoiceTree server.py

import sys
import os
from PyInstaller.utils.hooks import collect_all, collect_data_files, collect_submodules

block_cipher = None

# Collect all data files and hidden imports for key packages
datas = []
hiddenimports = []

# Collect backend module
hiddenimports += collect_submodules('backend')

# Collect all for key packages that might have dynamic imports
# Note: chromadb's ONNX embedding needs onnxruntime, tokenizers, tqdm, numpy
for package in ['langgraph', 'langchain_core', 'chromadb', 'onnxruntime', 'tokenizers', 'tqdm', 'google.generativeai']:
    tmp_datas, tmp_binaries, tmp_hiddenimports = collect_all(package)
    datas += tmp_datas
    hiddenimports += tmp_hiddenimports

# Additional hidden imports that might be dynamically loaded
hiddenimports += [
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
    'fastapi',
    'pydantic',
    'sklearn.feature_extraction',
    'sklearn.metrics.pairwise',
    # ChromaDB ONNX embedding function dependencies (dynamically imported)
    'onnxruntime',
    'tokenizers',
    'tqdm',
    'tqdm.std',
    'tqdm.utils',
    'numpy',
    'httpx',
    'tenacity',
]

# SPECPATH is set by PyInstaller to the directory containing this spec file
# Since spec is in scripts/, project root is one level up
import os
project_root = os.path.dirname(SPECPATH)
server_py = os.path.join(project_root, 'server.py')

a = Analysis(
    [server_py],
    pathex=[project_root],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Exclude heavy ML packages we don't need
        'torch',
        'torchvision',
        'torchaudio',
        'tensorflow',
        'keras',
        'sentence_transformers',
        'transformers',
        'whisper',
        'faster_whisper',
        'pyaudio',
        'speech_recognition',
        # Exclude test frameworks
        'pytest',
        'pytest_asyncio',
        'pytest_cov',
        # Exclude development tools
        'mypy',
        'ruff',
        'black',
        'ipython',
        'jupyter',
        'notebook',
        # Exclude NLTK entirely
        'nltk',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='voicetree-server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='voicetree-server',
)