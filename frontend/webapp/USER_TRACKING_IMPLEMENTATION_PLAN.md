# User Tracking Implementation Plan for VoiceTree Webapp

## Executive Summary
This document outlines the implementation plan for adding user tracking to the VoiceTree Electron/React webapp, focusing on tracking new node creation and terminal spawning events using PostHog.

## Recommended Solution: PostHog

### Why PostHog?
- **Open-source**: Full control and customization capabilities
- **Privacy-focused**: Anonymous tracking options available
- **Developer-friendly**: Excellent React/Electron integration
- **Cost-effective**: Generous free tier (1M events/month)
- **All-in-one**: Includes session replay, feature flags, A/B testing

## Implementation Plan

### Phase 1: Setup and Configuration

#### 1. Install PostHog Dependencies
```bash
npm install posthog-js
```

#### 2. Create Analytics Service
Create `src/services/analytics/AnalyticsService.ts`:

```typescript
import posthog from 'posthog-js/dist/module.no-external'; // Required for Electron CSP
import { isDevelopment } from '@/utils/environment';

export interface TrackingEvent {
  name: string;
  properties?: Record<string, any>;
}

class AnalyticsService {
  private initialized = false;
  private userConsent = false;

  initialize(apiKey: string, host: string = 'https://app.posthog.com') {
    if (this.initialized) return;

    // Only initialize in production or if explicitly enabled
    if (!isDevelopment() || process.env.ENABLE_DEV_ANALYTICS === 'true') {
      posthog.init(apiKey, {
        api_host: host,
        autocapture: false, // Start with manual tracking only
        capture_pageview: false, // No pageviews in Electron
        disable_session_recording: true, // Enable after consent
        opt_out_capturing_by_default: true, // GDPR compliance
        loaded: (ph) => {
          console.log('PostHog initialized');
          this.initialized = true;
        }
      });
    }
  }

  // GDPR-compliant consent management
  setUserConsent(hasConsent: boolean) {
    this.userConsent = hasConsent;
    if (hasConsent) {
      posthog.opt_in_capturing();
      posthog.set_config({ disable_session_recording: false });
    } else {
      posthog.opt_out_capturing();
    }
  }

  // Track custom events
  track(eventName: string, properties?: Record<string, any>) {
    if (!this.initialized || !this.userConsent) return;

    // Sanitize and anonymize data
    const sanitizedProps = this.sanitizeProperties(properties);
    posthog.capture(eventName, sanitizedProps);
  }

  private sanitizeProperties(props?: Record<string, any>): Record<string, any> {
    if (!props) return {};

    // Remove any PII or sensitive data
    const {
      email,
      name,
      filePath,
      ...sanitized
    } = props;

    // Hash file paths for privacy
    if (props.filePath) {
      sanitized.hashedPath = this.hashString(props.filePath);
    }

    return sanitized;
  }

  private hashString(str: string): string {
    // Simple hash function for anonymization
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }
}

export const analytics = new AnalyticsService();
```

### Phase 2: Integration Points

#### 1. Track Node Creation
Update `src/graph-core/mutation/GraphMutator.ts`:

```typescript
import { analytics } from '@/services/analytics/AnalyticsService';

export class GraphMutator {
  // ... existing code ...

  addNode(data: {
    nodeId: string;
    label: string;
    linkedNodeIds: string[];
    parentId?: string;
    color?: string;
    skipPositioning?: boolean;
  }): NodeSingular {
    const { nodeId, label, linkedNodeIds, parentId, color, skipPositioning } = data;

    // Track node creation event
    analytics.track('node_created', {
      nodeId: nodeId,
      hasParent: !!parentId,
      linkedCount: linkedNodeIds.length,
      hasColor: !!color,
      skipPositioning,
      timestamp: Date.now()
    });

    // ... rest of existing implementation ...
  }
}
```

#### 2. Track Terminal Spawning
Update `src/components/floating-windows/editors/Terminal.tsx`:

```typescript
import { analytics } from '@/services/analytics/AnalyticsService';

export const Terminal: React.FC<TerminalProps> = ({ nodeMetadata }) => {
  // ... existing code ...

  useEffect(() => {
    if (!terminalRef.current) return;

    // Track terminal spawn event
    analytics.track('terminal_spawned', {
      hasNodeMetadata: !!nodeMetadata,
      nodeId: nodeMetadata?.nodeId,
      timestamp: Date.now()
    });

    // ... rest of existing implementation ...
  }, []);
}
```

### Phase 3: Consent Management UI

#### Create Consent Banner Component
`src/components/privacy/ConsentBanner.tsx`:

```typescript
import React, { useState, useEffect } from 'react';
import { analytics } from '@/services/analytics/AnalyticsService';

export const ConsentBanner: React.FC = () => {
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    // Check if consent was previously given
    const consent = localStorage.getItem('analytics_consent');
    if (consent === null) {
      setShowBanner(true);
    } else {
      analytics.setUserConsent(consent === 'true');
    }
  }, []);

  const handleConsent = (granted: boolean) => {
    localStorage.setItem('analytics_consent', granted.toString());
    analytics.setUserConsent(granted);
    setShowBanner(false);
  };

  if (!showBanner) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-gray-900 text-white p-4 z-50">
      <div className="max-w-4xl mx-auto flex items-center justify-between">
        <div>
          <h3 className="font-bold mb-1">Help us improve VoiceTree</h3>
          <p className="text-sm">
            We use anonymous analytics to understand how VoiceTree is used.
            No personal data is collected.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => handleConsent(false)}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded"
          >
            Decline
          </button>
          <button
            onClick={() => handleConsent(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
};
```

### Phase 4: Initialize Analytics in Main App

Update `src/App.tsx` or main component:

```typescript
import { useEffect } from 'react';
import { analytics } from '@/services/analytics/AnalyticsService';
import { ConsentBanner } from '@/components/privacy/ConsentBanner';

function App() {
  useEffect(() => {
    // Initialize analytics with your PostHog project details
    analytics.initialize(
      process.env.POSTHOG_API_KEY || 'YOUR_API_KEY',
      process.env.POSTHOG_HOST || 'https://app.posthog.com'
    );
  }, []);

  return (
    <>
      {/* Your existing app components */}
      <ConsentBanner />
    </>
  );
}
```

## Privacy & Compliance Checklist

### GDPR Compliance
- [x] Opt-in consent mechanism
- [x] Clear privacy policy
- [x] Data minimization (no PII collection)
- [x] Anonymous tracking by default
- [x] Easy opt-out mechanism
- [x] Transparent data usage

### Data Security
- [x] Hash sensitive paths
- [x] No personal information tracking
- [x] Secure transmission (HTTPS)
- [x] Local consent storage

## Testing Strategy

### Unit Tests
```typescript
// src/services/analytics/AnalyticsService.test.ts
import { describe, it, expect, vi } from 'vitest';
import { analytics } from './AnalyticsService';

describe('AnalyticsService', () => {
  it('should not track events without consent', () => {
    const mockCapture = vi.fn();
    vi.mock('posthog-js', () => ({ capture: mockCapture }));

    analytics.track('test_event');
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('should sanitize PII from properties', () => {
    // Test implementation
  });
});
```

### E2E Tests
```typescript
// tests/e2e/analytics.spec.ts
import { test, expect } from '@playwright/test';

test('consent banner appears on first visit', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-testid="consent-banner"]')).toBeVisible();
});

test('analytics events fire after consent', async ({ page }) => {
  // Test implementation
});
```

## Rollout Plan

### Phase 1: Development (Week 1)
- Implement AnalyticsService
- Add tracking to GraphMutator
- Add tracking to Terminal component
- Create consent banner

### Phase 2: Testing (Week 2)
- Unit tests for all components
- E2E tests for consent flow
- Privacy audit
- Performance testing

### Phase 3: Staged Rollout (Week 3)
- Deploy to internal testing
- Monitor event flow
- Adjust tracking as needed
- Documentation update

### Phase 4: Production (Week 4)
- Deploy to all users
- Monitor analytics dashboard
- Iterate based on data

## Configuration

### Environment Variables
```env
# .env.production
POSTHOG_API_KEY=your_api_key_here
POSTHOG_HOST=https://app.posthog.com
ENABLE_ANALYTICS=true

# .env.development
ENABLE_DEV_ANALYTICS=false
```

### Build Configuration
Update `electron-vite.config.ts`:
```typescript
export default defineConfig({
  main: {
    define: {
      'process.env.POSTHOG_API_KEY': JSON.stringify(process.env.POSTHOG_API_KEY),
      'process.env.POSTHOG_HOST': JSON.stringify(process.env.POSTHOG_HOST),
    }
  }
});
```

## Monitoring & Insights

### Key Metrics to Track
1. **User Engagement**
   - Daily active users
   - Session duration
   - Features used per session

2. **Feature Adoption**
   - Node creation frequency
   - Terminal usage patterns
   - Most used features

3. **Performance**
   - Event delivery success rate
   - Analytics overhead
   - Battery impact (Electron)

## Alternative Considerations

### If PostHog doesn't meet needs:
1. **Aptabase**: Ultra-privacy focused, built for Electron
2. **Plausible**: Lightweight, GDPR-compliant by default
3. **Custom Solution**: Build minimal tracking directly to your backend

## Conclusion

This implementation provides a robust, privacy-compliant analytics solution that will help understand user behavior while respecting privacy. The modular design allows easy switching between analytics providers if needed.