import React from 'react'

export function isWebGLAvailable() {
  if (typeof window === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    return Boolean(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl') || canvas.getContext('webgl2'))
    )
  } catch {
    return false
  }
}

export default class ErrorBoundary3D extends React.Component {
  constructor(props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      reason: null,
    }
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      error,
      reason: error?.message || 'Three.js runtime initialization error',
    }
  }

  componentDidMount() {
    // Listen for asynchronous unhandled rejections (e.g. GLB or texture network failure)
    this.handleUnhandledRejection = (event) => {
      const reasonStr = event.reason?.message || String(event.reason || '')
      if (
        reasonStr.includes('GLTF') ||
        reasonStr.includes('glb') ||
        reasonStr.includes('WebGL') ||
        reasonStr.includes('THREE') ||
        reasonStr.includes('texture')
      ) {
        console.warn('Asynchronous 3D asset error detected:', event.reason)
        this.setState({
          hasError: true,
          error: event.reason,
          reason: `Asynchronous 3D asset loading failure: ${reasonStr}`,
        })
        if (this.props.onFallback) {
          this.props.onFallback(reasonStr)
        }
      }
    }
    window.addEventListener('unhandledrejection', this.handleUnhandledRejection)
  }

  componentWillUnmount() {
    if (this.handleUnhandledRejection) {
      window.removeEventListener('unhandledrejection', this.handleUnhandledRejection)
    }
  }

  componentDidCatch(error, errorInfo) {
    console.warn('3D Digital Twin Error caught by boundary:', error, errorInfo)
    if (this.props.onError) {
      this.props.onError(error)
    }
    if (this.props.onFallback) {
      this.props.onFallback(error.message)
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ width: '100%', height: '100%', position: 'relative' }}>
          {/* Explicit fallback notification banner */}
          <div
            data-testid="3d-fallback-banner"
            style={{
              position: 'absolute',
              top: 72,
              left: 14,
              right: 14,
              zIndex: 38,
              background: '#7f1d1d',
              color: '#fecaca',
              border: '1px solid #ef4444',
              borderRadius: '6px',
              padding: '6px 14px',
              fontSize: '11px',
              fontFamily: 'monospace',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>
              ⚠️ 3D SCENE FALLBACK ACTIVE: {this.state.reason || 'WebGL / Three.js initialization failed'}. Reverted to guaranteed 2D Heatmap.
            </span>
            <button
              onClick={() => this.setState({ hasError: false, error: null, reason: null })}
              style={{
                background: '#b91c1c',
                border: 'none',
                color: '#fff',
                borderRadius: '3px',
                padding: '2px 8px',
                fontSize: '10px',
                cursor: 'pointer',
              }}
            >
              Retry 3D
            </button>
          </div>
          {this.props.fallback}
        </div>
      )
    }

    return this.props.children
  }
}
