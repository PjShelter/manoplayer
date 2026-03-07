import { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';
import { CharacterPlayer, type CharacterModel } from 'webgal_mano';

PIXI.utils.skipHello();

interface PlayerCanvasProps {
  model: CharacterModel | null;
  activePoses: string[];
  layerVisibility: Record<string, boolean>;
}

export function PlayerCanvas({
  model,
  activePoses,
  layerVisibility
}: PlayerCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const playerRef = useRef<CharacterPlayer | null>(null);
  const dragStateRef = useRef<{
    pointerId: number | null;
    lastX: number;
    lastY: number;
  }>({
    pointerId: null,
    lastX: 0,
    lastY: 0
  });

  function fitPlayerToViewport(player: CharacterPlayer, app: PIXI.Application) {
    const bounds = player.getLocalBounds();
    if (bounds.width <= 1 || bounds.height <= 1) {
      return false;
    }

    const viewWidth = app.renderer.width || 1;
    const viewHeight = app.renderer.height || 1;
    const fitScale = Math.min(
      (viewWidth * 0.72) / bounds.width,
      (viewHeight * 0.78) / bounds.height,
      1
    );

    player.pivot.set(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    player.position.set(viewWidth / 2, viewHeight / 2);
    player.scale.set(fitScale);
    return true;
  }

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }

    const host = hostRef.current;
    const app = new PIXI.Application({
      resizeTo: host,
      autoDensity: true,
      backgroundAlpha: 0,
      antialias: true
    });

    const canvas = app.view as HTMLCanvasElement;
    host.appendChild(canvas);
    appRef.current = app;

    const onPointerDown = (event: PointerEvent) => {
      if (!playerRef.current) {
        return;
      }

      dragStateRef.current = {
        pointerId: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY
      };
      canvas.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (dragStateRef.current.pointerId !== event.pointerId || !playerRef.current) {
        return;
      }

      const deltaX = event.clientX - dragStateRef.current.lastX;
      const deltaY = event.clientY - dragStateRef.current.lastY;
      playerRef.current.position.x += deltaX;
      playerRef.current.position.y += deltaY;

      dragStateRef.current.lastX = event.clientX;
      dragStateRef.current.lastY = event.clientY;
    };

    const stopDragging = (event: PointerEvent) => {
      if (dragStateRef.current.pointerId !== event.pointerId) {
        return;
      }

      dragStateRef.current.pointerId = null;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const player = playerRef.current;
      const app = appRef.current;
      if (!player || !app) {
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const worldBefore = player.toLocal(new PIXI.Point(pointerX, pointerY), app.stage);
      const scaleFactor = event.deltaY < 0 ? 1.08 : 0.92;
      const nextScale = Math.min(8, Math.max(0.08, player.scale.x * scaleFactor));
      player.scale.set(nextScale);
      const worldAfter = player.toLocal(new PIXI.Point(pointerX, pointerY), app.stage);

      player.position.x += (worldAfter.x - worldBefore.x) * nextScale;
      player.position.y += (worldAfter.y - worldBefore.y) * nextScale;
    };

    const onDoubleClick = () => {
      const player = playerRef.current;
      const app = appRef.current;
      if (!player || !app) {
        return;
      }
      fitPlayerToViewport(player, app);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', stopDragging);
    canvas.addEventListener('pointercancel', stopDragging);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDoubleClick);

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', stopDragging);
      canvas.removeEventListener('pointercancel', stopDragging);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDoubleClick);
      playerRef.current?.destroy({ children: true, texture: false, baseTexture: false });
      playerRef.current = null;
      dragStateRef.current.pointerId = null;
      app.destroy(true, { children: true, texture: false, baseTexture: false });
      appRef.current = null;
    };
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app) {
      return;
    }

    playerRef.current?.destroy({ children: true, texture: false, baseTexture: false });
    playerRef.current = null;
    app.stage.removeChildren();

    if (!model) {
      return;
    }

    const player = new CharacterPlayer(model);
    player.resetToDefault();
    app.stage.addChild(player);
    playerRef.current = player;
    player.position.set((app.renderer.width || 1) / 2, (app.renderer.height || 1) / 2);

    if (fitPlayerToViewport(player, app)) {
      return;
    }

    let attempts = 0;
    const ticker = () => {
      attempts += 1;
      const fitted = fitPlayerToViewport(player, app);
      if (fitted || attempts > 180) {
        app.ticker.remove(ticker);
      }
    };
    app.ticker.add(ticker);
  }, [model]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !model) {
      return;
    }

    player.resetToDefault();
    activePoses.forEach((pose) => player.setPose(pose));

    Object.entries(layerVisibility).forEach(([layerId, visible]) => {
      player.setLayerVisible(layerId, visible);
    });
  }, [activePoses, layerVisibility, model]);

  return <div className="player-canvas" ref={hostRef} />;
}
