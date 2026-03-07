import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type { CharacterLayer, CharacterModel } from 'webgal_mano';
import { PlayerCanvas } from './PlayerCanvas';
import type { LoadedCharacterModel } from './types';

function withAssetUrls(model: CharacterModel, serverUrl: string, revision: number): CharacterModel {
  return {
    ...model,
    settings: {
      ...model.settings,
      basePath: ''
    },
    assets: {
      ...model.assets,
      layers: model.assets.layers.map((layer) => ({
        ...layer,
        path: `${serverUrl}/${encodeURI(layer.path.replace(/\\/g, '/').replace(/^\.\//, ''))}?v=${revision}`
      }))
    }
  };
}

function groupLayers(layers: CharacterLayer[]) {
  return layers.reduce<Record<string, CharacterLayer[]>>((acc, layer) => {
    acc[layer.group] ??= [];
    acc[layer.group].push(layer);
    return acc;
  }, {});
}

export default function App() {
  const [loaded, setLoaded] = useState<LoadedCharacterModel | null>(null);
  const [activePoses, setActivePoses] = useState<string[]>([]);
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const model = useMemo(
    () => (loaded ? withAssetUrls(loaded.model, loaded.serverUrl, loaded.revision) : null),
    [loaded]
  );
  const groupedLayers = useMemo(
    () => groupLayers(loaded?.model.assets.layers ?? []),
    [loaded]
  );

  async function handleOpenModel() {
    setError('');
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: 'WebGAL Mano Character Model',
          extensions: ['json']
        }
      ]
    });

    if (!selected || Array.isArray(selected)) {
      return;
    }

    setLoading(true);
    try {
      const response = await loadCharacterModel(selected);
      applyLoadedModel(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoaded(null);
      setActivePoses([]);
      setLayerVisibility({});
    } finally {
      setLoading(false);
    }
  }

  async function loadCharacterModel(modelPath: string) {
    return invoke<LoadedCharacterModel>('load_character_model', { modelPath });
  }

  function applyLoadedModel(response: LoadedCharacterModel) {
    setLoaded(response);
    setActivePoses(response.model.controller.defaultPoses ?? []);
    setLayerVisibility({});
  }

  function togglePose(pose: string) {
    setActivePoses((current) =>
      current.includes(pose)
        ? current.filter((item) => item !== pose)
        : [...current, pose]
    );
  }

  function toggleLayer(layerId: string) {
    setLayerVisibility((current) => ({
      ...current,
      [layerId]: !(current[layerId] ?? false)
    }));
  }

  function resetState() {
    if (!loaded) {
      return;
    }
    setActivePoses(loaded.model.controller.defaultPoses ?? []);
    setLayerVisibility({});
  }

  useEffect(() => {
    if (!loaded) {
      return;
    }

    let cancelled = false;

    const timer = window.setInterval(async () => {
      try {
        const latestRevision = await invoke<number>('get_character_revision', {
          modelPath: loaded.modelPath
        });

        if (!cancelled && latestRevision > loaded.revision) {
          const refreshed = await loadCharacterModel(loaded.modelPath);
          if (!cancelled) {
            setLoaded(refreshed);
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('热更新检查失败:', err);
        }
      }
    }, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loaded]);

  return (
    <main className="app-shell">
      <section className="control-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">DONGSHAN X SHELTER</p>
            <h1>Mano Player</h1>
          </div>
          <button className="primary-button" onClick={handleOpenModel} disabled={loading}>
            {loading ? '加载中...' : '打开角色模型'}
          </button>
        </div>

        {error ? <div className="error-box">{error}</div> : null}

        <div className="meta-card">
          <div className="meta-row">
            <span>名称</span>
            <strong>{loaded?.model.metadata.name ?? '未加载'}</strong>
          </div>
          <div className="meta-row">
            <span>默认姿势</span>
            <strong>{loaded?.model.controller.defaultPoses.join(', ') || '-'}</strong>
          </div>
          <div className="meta-row path-row">
            <span>文件</span>
            <strong>{loaded?.modelPath ?? '-'}</strong>
          </div>
        </div>

        <div className="section-header">
          <h2>姿势控制</h2>
          <button className="ghost-button" onClick={resetState} disabled={!loaded}>
            重置
          </button>
        </div>

        <div className="chip-grid">
          {loaded
            ? Object.keys(loaded.model.controller.poses).map((pose) => (
                <button
                  key={pose}
                  className={activePoses.includes(pose) ? 'chip active' : 'chip'}
                  onClick={() => togglePose(pose)}
                >
                  {pose}
                </button>
              ))
            : <span className="empty-state">加载模型后显示可用姿势</span>}
        </div>

        <div className="section-header">
          <h2>差分图层</h2>
          <span className="section-hint">手动覆盖优先级高于姿势预设</span>
        </div>

        <div className="layer-groups">
          {loaded
            ? Object.entries(groupedLayers).map(([group, layers]) => (
                <div className="layer-group" key={group}>
                  <h3>{group}</h3>
                  {layers.map((layer) => {
                    const checked = layerVisibility[layer.id] ?? false;
                    return (
                      <label className="layer-toggle" key={layer.id}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleLayer(layer.id)}
                        />
                        <span>{layer.name}</span>
                      </label>
                    );
                  })}
                </div>
              ))
            : <span className="empty-state">加载模型后显示图层列表</span>}
        </div>
      </section>

      <section className="stage-panel">
        <div className="stage-frame">
          <PlayerCanvas
            model={model}
            activePoses={activePoses}
            layerVisibility={layerVisibility}
          />
        </div>
      </section>
    </main>
  );
}
