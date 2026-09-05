import * as THREE from 'three'

/**
 * Direct safe Texture Loader with error callback triggering 2D fallback
 */
export function loadSafeTexture(url, onLoad, onErrorFallback) {
  const loader = new THREE.TextureLoader()
  return loader.load(
    url,
    (texture) => {
      if (onLoad) onLoad(texture)
    },
    undefined,
    (err) => {
      console.error(`Direct texture loading error for ${url}:`, err)
      if (onErrorFallback) {
        onErrorFallback(`Texture asset failed to load: ${err?.message || url}`)
      }
    }
  )
}

/**
 * Direct safe GLB / GLTF Loader with error callback triggering 2D fallback
 */
export function loadSafeGLTF(gltfLoaderInstance, url, onLoad, onErrorFallback) {
  if (!gltfLoaderInstance || typeof gltfLoaderInstance.load !== 'function') {
    if (onErrorFallback) {
      onErrorFallback('GLTF loader instance unavailable or failed to initialize')
    }
    return
  }

  gltfLoaderInstance.load(
    url,
    (gltf) => {
      if (onLoad) onLoad(gltf)
    },
    undefined,
    (err) => {
      console.error(`Direct GLB/GLTF loading error for ${url}:`, err)
      if (onErrorFallback) {
        onErrorFallback(`GLB asset failed to load: ${err?.message || url}`)
      }
    }
  )
}
