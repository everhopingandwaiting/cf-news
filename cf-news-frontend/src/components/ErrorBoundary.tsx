import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: { componentStack?: string }) {
        console.error('ErrorBoundary caught:', error, info.componentStack);
    }

    reset = () => this.setState({ error: null });

    render() {
        if (!this.state.error) return this.props.children;
        const err = this.state.error;
        return (
            <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif' }}>
                <h1 style={{ fontSize: 20, margin: '0 0 12px' }}>出错了</h1>
                <p style={{ color: '#666', margin: '0 0 16px' }}>页面遇到问题，可以尝试刷新。</p>
                <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 6, fontSize: 12, color: '#c00' }}>
                    {err.name}: {err.message}
                </pre>
                <button onClick={this.reset} style={{ marginTop: 12, padding: '6px 14px', border: '1px solid #ccc', borderRadius: 6, background: '#fff', cursor: 'pointer' }}>
                    重试
                </button>
            </div>
        );
    }
}
