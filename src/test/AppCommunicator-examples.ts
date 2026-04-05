/**
 * Examples of using the AppCommunicator for different app components
 * This file demonstrates how the refactored AppCommunicator can be used
 * for various communication scenarios beyond just the work center.
 */

// Example 1: Using predefined channels
import { getWorkCenterComm, getMarkdownViewerComm, getSettingsComm, getAppCommunicator, APP_CHANNELS } from './AppCommunicator';

// Work center communication (existing functionality)
const workCenterComm = getWorkCenterComm();

// Markdown viewer communication (new - for coordinating with markdown viewers)
const markdownComm = getMarkdownViewerComm();

// Settings communication (new - for settings synchronization)
const settingsComm = getSettingsComm();

// Example 2: Custom channels for specific features
const customComm = getAppCommunicator('rs-custom-feature', {
    availabilityCheckInterval: 1000, // Check more frequently
    retryInterval: 10000 // Retry more often
});

// Example 3: Dynamic channel creation
function createFeatureCommunicator(featureName: string) {
    return getAppCommunicator(`rs-feature-${featureName}`, {
        availabilityCheckInterval: 3000,
        retryInterval: 20000
    });
}

// Example usage in different components:

// In a hypothetical ImageEditor component
export class ImageEditor {
    private communicator = getAppCommunicator('rs-image-editor');

    async processImage(imageData: any) {
        // Send processed image to work center
        await this.communicator.sendMessage('image-processed', {
            imageData,
            timestamp: Date.now()
        }, { priority: 'high' });
    }

    async requestImageFromWorkCenter() {
        // Request image data from work center
        await this.communicator.sendMessage('request-image-data', {
            requestedFormat: 'png'
        });
    }
}

// In a hypothetical DataExporter component
export class DataExporter {
    private communicator = getAppCommunicator('rs-data-exporter', {
        availabilityCheckInterval: 5000, // Less frequent checks
        retryInterval: 45000 // Longer retry intervals
    });

    async exportData(data: any, format: string) {
        // Notify work center about export completion
        await this.communicator.sendMessage('data-exported', {
            data,
            format,
            exportId: `export_${Date.now()}`
        }, { priority: 'normal' });
    }
}

// Example of inter-component communication
export async function coordinateComponents() {
    // Component A sends message to Component B
    const commA = getAppCommunicator('component-a');
    await commA.sendMessage('data-ready', { someData: 'value' });

    // Component B receives and responds
    const commB = getAppCommunicator('component-b');
    await commB.sendMessage('data-processed', { result: 'success' });
}

// Example of broadcasting to multiple targets
export async function broadcastToMultipleTargets(message: any) {
    const targets = [
        APP_CHANNELS.WORK_CENTER,
        APP_CHANNELS.MARKDOWN_VIEWER,
        'rs-custom-target'
    ];

    for (const target of targets) {
        const comm = getAppCommunicator(target);
        await comm.sendMessage('broadcast-message', message, {
            priority: 'low',
            queueIfUnavailable: true
        });
    }
}

/*
Benefits of the refactored AppCommunicator:

1. **Generic Design**: Can be used for any component communication, not just work center
2. **Configurable Channels**: Different channels for different communication needs
3. **Flexible Options**: Customizable timing, retry logic, and priorities per channel
4. **Singleton Management**: Efficient resource usage with singleton instances
5. **Backward Compatibility**: Existing work center code continues to work
6. **Extensible**: Easy to add new communication channels as needed

Usage patterns:
- getWorkCenterComm() - for work center operations (backward compatible)
- getMarkdownViewerComm() - for markdown viewer coordination
- getSettingsComm() - for settings synchronization
- getAppCommunicator('custom-channel') - for custom communications
*/