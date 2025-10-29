import { Disposable } from './Disposable';
import { EventEmitter } from './EventEmitter';
import {
  SonioxClient,
  type RecorderState,
  type Token,
} from '@soniox/speech-to-text-web';
import getAPIKey from '@/utils/get-api-key';

/**
 * VoiceInputView - Vanilla TypeScript voice input component
 *
 * Wraps Soniox SDK for speech-to-text transcription and provides
 * a simple UI for recording and text input.
 *
 * Usage:
 * ```typescript
 * const container = document.getElementById('voice-input-container');
 * const view = new VoiceInputView(container, 'http://localhost:8001/api');
 *
 * view.onTranscription((text) => console.log('Transcribed:', text));
 * view.onError((error) => console.error('Error:', error));
 *
 * await view.startRecording();
 * // ... user speaks ...
 * view.stopRecording();
 *
 * view.dispose(); // cleanup
 * ```
 */
export class VoiceInputView extends Disposable {
  // Core instances
  private container: HTMLElement;
  private _apiEndpoint: string; // Reserved for future backend integration
  private sonioxClient: SonioxClient | null = null;

  // State
  private state: RecorderState = 'Init';
  private finalTokens: Token[] = [];
  private nonFinalTokens: Token[] = [];

  // Event emitters
  private transcriptionEmitter = new EventEmitter<string>();
  private errorEmitter = new EventEmitter<string>();

  // DOM references
  private recordButton: HTMLButtonElement | null = null;
  private textInput: HTMLInputElement | null = null;
  private transcriptionDisplay: HTMLDivElement | null = null;

  /**
   * Create a new VoiceInputView
   *
   * @param container HTMLElement to render UI into
   * @param apiEndpoint Backend API endpoint for sending transcriptions
   */
  constructor(container: HTMLElement, apiEndpoint: string) {
    super();

    this.container = container;
    this._apiEndpoint = apiEndpoint;

    // Initialize Soniox SDK
    this.initializeSonioxClient();

    // Check microphone permissions
    this.checkMicrophonePermissions();

    // Render UI
    this.render();
  }

  /**
   * Initialize Soniox SDK client
   */
  private initializeSonioxClient(): void {
    this.sonioxClient = new SonioxClient({
      apiKey: getAPIKey,
    });
  }

  /**
   * Check microphone permissions on initialization
   */
  private checkMicrophonePermissions(): void {
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        console.log('✅ Microphone permission granted');
        // Stop the stream immediately, we just wanted to check permissions
        stream.getTracks().forEach((track) => track.stop());
      })
      .catch((err) => {
        console.error('❌ Microphone permission denied:', err);
        this.errorEmitter.emit('Microphone permission denied');
      });
  }

  /**
   * Render UI controls
   */
  private render(): void {
    // Clear container
    this.container.innerHTML = '';

    // Create main wrapper
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display: flex; flex-direction: column; gap: 12px; padding: 16px;';

    // Create transcription display
    this.transcriptionDisplay = document.createElement('div');
    this.transcriptionDisplay.style.cssText =
      'min-height: 80px; padding: 12px; border: 1px solid #ccc; border-radius: 4px; ' +
      'overflow-y: auto; background: white; font-family: system-ui;';
    this.transcriptionDisplay.textContent = 'Click record button to start transcribing...';

    // Create controls container
    const controls = document.createElement('div');
    controls.style.cssText = 'display: flex; gap: 8px; align-items: center;';

    // Create record button
    this.recordButton = document.createElement('button');
    this.recordButton.textContent = '🎤 Record';
    this.recordButton.style.cssText =
      'padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; ' +
      'background: #3b82f6; color: white; font-weight: 500;';
    this.recordButton.addEventListener('click', () => this.handleRecordButtonClick());

    // Create text input
    this.textInput = document.createElement('input');
    this.textInput.type = 'text';
    this.textInput.placeholder = 'Or type text here...';
    this.textInput.style.cssText =
      'flex: 1; padding: 8px 12px; border: 1px solid #ccc; border-radius: 4px;';
    this.textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.handleTextSubmit();
      }
    });

    // Create send button
    const sendButton = document.createElement('button');
    sendButton.textContent = 'Send';
    sendButton.style.cssText =
      'padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; ' +
      'background: #3b82f6; color: white; font-weight: 500;';
    sendButton.addEventListener('click', () => this.handleTextSubmit());

    // Assemble UI
    controls.appendChild(this.recordButton);
    controls.appendChild(this.textInput);
    controls.appendChild(sendButton);

    wrapper.appendChild(this.transcriptionDisplay);
    wrapper.appendChild(controls);

    this.container.appendChild(wrapper);
  }

  /**
   * Handle record button click
   */
  private handleRecordButtonClick(): void {
    if (this.state === 'Running') {
      this.stopRecording();
    } else {
      this.startRecording();
    }
  }

  /**
   * Handle text input submission
   */
  private handleTextSubmit(): void {
    if (!this.textInput) return;

    const text = this.textInput.value.trim();
    if (!text) return;

    // Emit transcription event
    this.transcriptionEmitter.emit(text);

    // Update display
    this.updateTranscriptionDisplay(text);

    // Clear input
    this.textInput.value = '';
  }

  /**
   * Update transcription display with new text
   */
  private updateTranscriptionDisplay(text: string): void {
    if (!this.transcriptionDisplay) return;

    const currentText = this.transcriptionDisplay.textContent || '';
    if (currentText === 'Click record button to start transcribing...') {
      this.transcriptionDisplay.textContent = text;
    } else {
      this.transcriptionDisplay.textContent = currentText + ' ' + text;
    }
  }

  /**
   * Update record button UI based on state
   */
  private updateRecordButtonUI(): void {
    if (!this.recordButton) return;

    if (this.state === 'Running') {
      this.recordButton.textContent = '⏹️ Stop';
      this.recordButton.style.background = '#ef4444';
    } else {
      this.recordButton.textContent = '🎤 Record';
      this.recordButton.style.background = '#3b82f6';
    }
  }

  /**
   * Start recording
   */
  public async startRecording(): Promise<void> {
    if (!this.sonioxClient) {
      this.errorEmitter.emit('Soniox client not initialized');
      return;
    }

    // Reset state
    this.finalTokens = [];
    this.nonFinalTokens = [];

    this.sonioxClient.start({
      model: 'stt-rt-preview',
      enableLanguageIdentification: true,
      enableSpeakerDiarization: true,
      enableEndpointDetection: true,

      onStarted: () => {
        console.log('Recording started');
      },

      onFinished: () => {
        console.log('Recording finished');
      },

      onError: (status, message, errorCode) => {
        console.error('Soniox Error:', status, message, errorCode);
        this.errorEmitter.emit(`Soniox error: ${message}`);
      },

      onStateChange: ({ newState }) => {
        this.state = newState;
        this.updateRecordButtonUI();
      },

      onPartialResult: (result) => {
        const newFinalTokens: Token[] = [];
        const newNonFinalTokens: Token[] = [];

        for (const token of result.tokens) {
          if (token.is_final) {
            newFinalTokens.push(token);
          } else {
            newNonFinalTokens.push(token);
          }
        }

        // Accumulate final tokens
        this.finalTokens = [...this.finalTokens, ...newFinalTokens];
        this.nonFinalTokens = newNonFinalTokens;

        // Emit transcription for final tokens
        if (newFinalTokens.length > 0) {
          const transcription = this.tokensToText(newFinalTokens);
          this.transcriptionEmitter.emit(transcription);
          this.updateTranscriptionDisplay(transcription);
        }

        // Update display with all tokens (final + non-final)
        const allText = this.tokensToText([...this.finalTokens, ...this.nonFinalTokens]);
        if (this.transcriptionDisplay && allText) {
          this.transcriptionDisplay.textContent = allText;
        }
      },
    });
  }

  /**
   * Stop recording
   */
  public stopRecording(): void {
    if (!this.sonioxClient) return;
    this.sonioxClient.stop();
  }

  /**
   * Check if currently recording
   */
  public isRecording(): boolean {
    return this.state === 'Running';
  }

  /**
   * Subscribe to transcription events
   *
   * @param callback Function to call when transcription is received
   * @returns Unsubscribe function
   */
  public onTranscription(callback: (text: string) => void): () => void {
    return this.transcriptionEmitter.on(callback);
  }

  /**
   * Subscribe to error events
   *
   * @param callback Function to call when error occurs
   * @returns Unsubscribe function
   */
  public onError(callback: (error: string) => void): () => void {
    return this.errorEmitter.on(callback);
  }

  /**
   * Convert tokens to text string
   */
  private tokensToText(tokens: Token[]): string {
    return tokens
      .filter((token) => token.text !== '<end>')
      .map((token) => token.text)
      .join('');
  }

  /**
   * Dispose of resources
   */
  public dispose(): void {
    if (this.isDisposed) return;

    // Stop recording if active
    if (this.isRecording()) {
      this.stopRecording();
    }

    // Cancel Soniox client
    if (this.sonioxClient) {
      this.sonioxClient.cancel();
      this.sonioxClient = null;
    }

    // Clear event emitters
    this.transcriptionEmitter.clear();
    this.errorEmitter.clear();

    // Clear DOM references
    this.recordButton = null;
    this.textInput = null;
    this.transcriptionDisplay = null;

    // Clear container
    this.container.innerHTML = '';

    // Call parent dispose
    super.dispose();
  }
}
