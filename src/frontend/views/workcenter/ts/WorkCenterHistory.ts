import { H } from "fest/lure";
import { actionHistory } from "@rs-com/service/misc/ActionHistory";
import type { ActionEntry } from "@rs-com/service/misc/ActionHistory";
import type { WorkCenterState, WorkCenterDependencies } from "./WorkCenterState";

export class WorkCenterHistory {
    private container: HTMLElement | null = null;
    private deps: WorkCenterDependencies;

    constructor(dependencies: WorkCenterDependencies) {
        this.deps = dependencies;
    }

    setContainer(container: HTMLElement | null): void {
        this.container = container;
    }

    // Update recent history display
    updateRecentHistory(state: WorkCenterState): void {
        if (!this.container) return;
        const historyContainer = this.container.querySelector('[data-recent-history]') as HTMLElement;
        if (!historyContainer) return;

        historyContainer.innerHTML = '';

        // Get recent entries from action history (workcenter only)
        const recentItems = actionHistory.getRecentEntries(10).filter(
            entry => entry.context.source === 'workcenter' && entry.status === 'completed'
        );

        if (recentItems.length === 0) {
            historyContainer.innerHTML = '<div class="wc-history-empty">No recent activity</div>';
            return;
        }

        recentItems.slice(0, 3).forEach(item => {
            const historyItem = H`<div class="history-item-compact">
        <div class="history-meta">
          <span class="history-status ${item.result?.type !== 'error' ? 'success' : 'error'}">${item.result?.type !== 'error' ? '✓' : '✗'}</span>
          <span class="history-prompt">${item.input.text?.substring(0, 50) || item.action}${item.input.text && item.input.text.length > 50 ? '...' : ''}</span>
          ${item.result?.processingTime ? H`<span class="history-time">${Math.round(item.result.processingTime / 1000)}s</span>` : ''}
        </div>
        <button class="btn small" data-restore="${item.id}">Use</button>
      </div>` as HTMLElement;

            historyItem.querySelector('button')?.addEventListener('click', () => {
                if (item.input.text) {
                    state.currentPrompt = item.input.text;
                    // This will be handled by the inputs module
                    this.deps.showMessage?.('Restored prompt from history');
                }
            });

            historyContainer.append(historyItem);
        });
    }

    // Update action history stats
    updateActionHistory(): void {
        if (!this.container) return;
        // Update action history stats if there's a stats display
        const statsContainer = this.container.querySelector('[data-action-stats]') as HTMLElement;
        if (statsContainer) {
            const stats = actionHistory.getStats();
            statsContainer.innerHTML = `
                <div class="stats-item">Total: ${stats.total}</div>
                <div class="stats-item">Success: ${stats.completed}</div>
                <div class="stats-item">Failed: ${stats.failed}</div>
            `;
        }
    }

    // Show full action history modal
    showActionHistory(): void {
        if (!this.container) return;

        const actionEntries = actionHistory.getRecentEntries(50).filter(
            entry => entry.context.source === 'workcenter'
        );

        const modal = H`<div class="action-history-modal">
      <div class="modal-content">
        <div class="modal-header">
          <h3>Action History</h3>
          <div class="modal-actions">
            <button class="btn btn-icon" data-action="export-history" title="Export History">
              <ui-icon icon="download" size="18" icon-style="duotone"></ui-icon>
            </button>
            <button class="btn btn-icon" data-action="clear-history" title="Clear History">
              <ui-icon icon="trash" size="18" icon-style="duotone"></ui-icon>
            </button>
            <button class="btn" data-action="close-modal">Close</button>
          </div>
        </div>

        <div class="history-stats">
          ${(() => {
            const stats = actionHistory.getStats();
            return H`
              <div class="stat-card">
                <div class="stat-value">${stats.total}</div>
                <div class="stat-label">Total Actions</div>
              </div>
              <div class="stat-card">
                <div class="stat-value success">${stats.completed}</div>
                <div class="stat-label">Completed</div>
              </div>
              <div class="stat-card">
                <div class="stat-value error">${stats.failed}</div>
                <div class="stat-label">Failed</div>
              </div>
              <div class="stat-card">
                <div class="stat-value">${stats.byAction['recognize'] || 0}</div>
                <div class="stat-label">Recognitions</div>
              </div>
            `;
          })()}
        </div>

        <div class="history-filters">
          <select class="filter-select" data-filter="status">
            <option value="">All Status</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="processing">Processing</option>
          </select>
          <select class="filter-select" data-filter="action">
            <option value="">All Actions</option>
            <option value="recognize">Recognize</option>
            <option value="analyze">Analyze</option>
            <option value="process">Process</option>
          </select>
        </div>

        <div class="action-history-list">
          ${actionEntries.length === 0 ? H`<div class="wc-history-empty">No actions found</div>` :
            actionEntries.map(entry => H`<div class="action-history-item ${entry.status}">
              <div class="action-header">
                <div class="action-meta">
                  <span class="action-status ${entry.status}">${this.getStatusIcon(entry.status)}</span>
                  <span class="action-type">${entry.action}</span>
                  <span class="action-time">${this.formatTimeAgo(entry.timestamp)}</span>
                  ${entry.result?.processingTime ? H`<span class="action-duration">${Math.round(entry.result.processingTime / 1000)}s</span>` : ''}
                </div>
                <div class="action-actions">
                  ${entry.result ? H`<button class="btn small" data-restore-action="${entry.id}">Use Result</button>` : ''}
                  <button class="btn small" data-view-details="${entry.id}">Details</button>
                </div>
              </div>

              <div class="action-content">
                <div class="input-preview">
                  <strong>Input:</strong>
                  ${entry.input.files?.length ?
                    `${entry.input.files.length} file(s): ${entry.input.files.map(f => f.name).join(', ')}` :
                    entry.input.text?.substring(0, 100) || 'No input'
                  }
                  ${entry.input.text && entry.input.text.length > 100 ? '...' : ''}
                </div>

                ${entry.result ? H`<div class="result-preview">
                  <strong>Result:</strong>
                  <div class="result-content">${entry.result.content.substring(0, 200)}${entry.result.content.length > 200 ? '...' : ''}</div>
                </div>` : ''}

                ${entry.error ? H`<div class="error-preview">
                  <strong>Error:</strong> ${entry.error}
                </div>` : ''}
              </div>
            </div>`)}
        </div>
      </div>
    </div>` as HTMLElement;

        // Add event listeners
        modal.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const action = target.getAttribute('data-action') || target.closest('[data-action]')?.getAttribute('data-action');
            const entryId = target.getAttribute('data-restore-action') || target.getAttribute('data-view-details');

            if (action === 'close-modal') {
                modal.remove();
            } else if (action === 'export-history') {
                this.exportActionHistory();
            } else if (action === 'clear-history') {
                if (confirm('Are you sure you want to clear all action history?')) {
                    actionHistory.clearEntries();
                    modal.remove();
                    this.updateRecentHistory({} as WorkCenterState);
                }
            } else if (entryId) {
                const entry = actionHistory.getEntry(entryId);
                if (entry) {
                    if (target.hasAttribute('data-restore-action') && entry.result) {
                        // Restore result to output - this will be handled by results module
                        this.deps.showMessage?.('Result restored from history');
                        modal.remove();
                    } else if (target.hasAttribute('data-view-details')) {
                        this.showActionDetails(entry);
                    }
                }
            }
        });

        // Add filter listeners
        modal.querySelectorAll('.filter-select').forEach(select => {
            select.addEventListener('change', () => this.applyHistoryFilters(modal));
        });

        this.container.append(modal);
    }

    // Show action details modal
    private showActionDetails(entry: ActionEntry): void {
        const modal = H`<div class="action-details-modal">
      <div class="modal-content">
        <div class="modal-header">
          <h3>Action Details</h3>
          <button class="btn" data-action="close-modal">Close</button>
        </div>

        <div class="details-grid">
          <div class="detail-item">
            <label>ID:</label>
            <span>${entry.id}</span>
          </div>
          <div class="detail-item">
            <label>Timestamp:</label>
            <span>${new Date(entry.timestamp).toLocaleString()}</span>
          </div>
          <div class="detail-item">
            <label>Source:</label>
            <span>${entry.context.source}</span>
          </div>
          <div class="detail-item">
            <label>Action:</label>
            <span>${entry.action}</span>
          </div>
          <div class="detail-item">
            <label>Status:</label>
            <span class="status-${entry.status}">${entry.status}</span>
          </div>
          ${entry.result?.processingTime ? H`<div class="detail-item">
            <label>Processing Time:</label>
            <span>${Math.round(entry.result.processingTime / 1000)}s</span>
          </div>` : ''}
        </div>

        <div class="details-section">
          <h4>Input</h4>
          <div class="input-details">
            <div>Type: ${entry.input.type}</div>
            ${entry.input.files ? H`<div>Files: ${entry.input.files.map(f => f.name).join(', ')}</div>` : ''}
            ${entry.input.text ? H`<div>Text: <pre>${entry.input.text}</pre></div>` : ''}
          </div>
        </div>

        ${entry.result ? H`<div class="details-section">
          <h4>Result</h4>
          <div class="result-details">
            <div>Type: ${entry.result.type}</div>
            <div>Auto Copied: ${entry.result.autoCopied ? 'Yes' : 'No'}</div>
            <div>Content: <pre>${entry.result.content}</pre></div>
          </div>
        </div>` : ''}

        ${entry.error ? H`<div class="details-section">
          <h4>Error</h4>
          <div class="error-details">${entry.error}</div>
        </div>` : ''}
      </div>
    </div>` as HTMLElement;

        modal.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).getAttribute('data-action') === 'close-modal') {
                modal.remove();
            }
        });

        document.body.append(modal);
    }

    // Apply filters to history modal
    private applyHistoryFilters(modal: HTMLElement): void {
        const statusFilter = (modal.querySelector('[data-filter="status"]') as HTMLSelectElement).value;
        const actionFilter = (modal.querySelector('[data-filter="action"]') as HTMLSelectElement).value;

        const items = modal.querySelectorAll('.action-history-item');
        items.forEach(item => {
            const status = item.classList[1]; // Second class is status
            const action = item.querySelector('.action-type')?.textContent || '';

            const statusMatch = !statusFilter || status === statusFilter;
            const actionMatch = !actionFilter || action === actionFilter;

            (item as HTMLElement).style.display = statusMatch && actionMatch ? 'block' : 'none';
        });
    }

    // Export action history
    private exportActionHistory(): void {
        const data = actionHistory.exportEntries('json');
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = `action-history-${new Date().toISOString().split('T')[0]}.json`;
        document.body.append(link);
        link.click();
        link.remove();

        URL.revokeObjectURL(url);
        this.deps.showMessage?.('History exported successfully');
    }

    // Helper methods
    private getStatusIcon(status: ActionEntry['status']): string {
        switch (status) {
            case 'completed': return '✓';
            case 'failed': return '✗';
            case 'processing': return '⟳';
            case 'pending': return '⏳';
            case 'cancelled': return '⊗';
            default: return '?';
        }
    }

    private formatTimeAgo(timestamp: number): string {
        const now = Date.now();
        const diff = now - timestamp;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (days > 0) return `${days}d ago`;
        if (hours > 0) return `${hours}h ago`;
        if (minutes > 0) return `${minutes}m ago`;
        return 'Just now';
    }

    // Get last successful prompt from history
    getLastSuccessfulPrompt(): string {
        const lastSuccessful = this.deps.history.find(h => h.ok);
        return lastSuccessful?.prompt || "Process the provided content";
    }
}