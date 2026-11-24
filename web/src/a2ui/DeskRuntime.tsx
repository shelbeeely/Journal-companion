import { useEffect, useMemo, useRef } from 'react';
import { MessageProcessor, type SurfaceModel } from '@a2ui/web_core/v0_9';
import { A2uiSurface } from '@a2ui/react/v0_9';
import { DeskAgent, SURFACES, type A2uiMessage, type DeskSurfaceInput, type SurfaceId } from '../core/a2ui/deskAgent';
import type { TaskComposition } from '../core/insights';
import { deskCatalog } from './deskCatalog';
import { MomentAgent, snapshotMessages, surfaceIdFor, type MomentRenderOptions } from '../core/a2ui/momentAgent';
import type { Suggestion } from '../core/context/moments';

export type DeskActionHandler = (name: string, context: Record<string, unknown>) => void;

/* One processor + agent per page; every surface (desk, glance, context, ambient) shares them. */
let actionHandler: DeskActionHandler = () => undefined;
const processor = new MessageProcessor([deskCatalog], (action) => actionHandler(action.name, action.context ?? {}), {
  reportErrorsOnly: true,
  errorHandler: (err) => console.warn('[a2ui]', err),
});
const agent = new DeskAgent();

function apply(messages: A2uiMessage[]) {
  if (messages.length) processor.processMessages(messages as never);
}

type Props =
  | { surfaceId: Exclude<SurfaceId, typeof SURFACES.glance>; input: DeskSurfaceInput; onAction: DeskActionHandler }
  | { surfaceId: typeof SURFACES.glance; glance: { composition: TaskComposition }; onAction: DeskActionHandler };

/** Feeds the local desk agent's A2UI messages into the processor and renders the surface. */
export default function DeskRuntime(props: Props) {
  const handlerRef = useRef(props.onAction);
  handlerRef.current = props.onAction;

  useEffect(() => {
    actionHandler = (name, ctx) => handlerRef.current(name, ctx);
  }, []);

  const payload = 'input' in props ? props.input : props.glance;
  // Sync before paint so a surface never flashes the previous screen's data. The agent only emits
  // messages for real changes, so repeating this (e.g. StrictMode double render) is a no-op.
  const surface = useMemo(() => {
    apply('input' in props ? agent.syncDesk(props.surfaceId, props.input) : agent.syncGlance(props.glance));
    return (processor.model.surfacesMap.get(props.surfaceId) as SurfaceModel<never> | undefined) ?? null;
    // payload identity changes whenever the composition does
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.surfaceId, payload]);

  return surface ? (
    <div className="a2-surface" data-surface={props.surfaceId}>
      <A2uiSurface surface={surface} />
    </div>
  ) : null;
}

/* ------------------------------ Moment surfaces ------------------------------ */

const momentAgent = new MomentAgent();

export interface MomentSurfaceProps {
  suggestion: Suggestion;
  options: MomentRenderOptions;
  onAction: DeskActionHandler;
}

/** One generated, task-specific interface for a cross-source suggestion. */
export function MomentSurface({ suggestion, options, onAction }: MomentSurfaceProps) {
  const handlerRef = useRef(onAction);
  handlerRef.current = onAction;
  useEffect(() => {
    actionHandler = (name, ctx) => handlerRef.current(name, ctx);
  }, []);
  const surfaceId = surfaceIdFor(suggestion.key);
  // Coarse clock (per minute) so "Starts in N min" stays current without re-sending every tick.
  const minute = Math.floor(Date.now() / 60_000);
  const surface = useMemo(() => {
    apply(momentAgent.sync(suggestion, options, Date.now(), surfaceId));
    return (processor.model.surfacesMap.get(surfaceId) as SurfaceModel<never> | undefined) ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestion, options, surfaceId, minute]);
  return surface ? (
    <div className="a2-surface" data-surface={surfaceId} data-moment={suggestion.moment}>
      <A2uiSurface surface={surface} />
    </div>
  ) : null;
}

/** Re-renders a saved interface from its stored A2UI messages (read-only). */
export function SnapshotSurface({ id, messages }: { id: string; messages: Record<string, unknown>[] }) {
  const surfaceId = `saved_${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const surface = useMemo(() => {
    if (!processor.model.surfacesMap.get(surfaceId)) {
      // Rewrite the stored surface id so several saved views can coexist with live ones.
      const msgs = messages.map((m) => JSON.parse(JSON.stringify(m).replace(/"surfaceId":"[^"]+"/g, `"surfaceId":"${surfaceId}"`)));
      apply(msgs as A2uiMessage[]);
    }
    return (processor.model.surfacesMap.get(surfaceId) as SurfaceModel<never> | undefined) ?? null;
  }, [surfaceId, messages]);
  return surface ? (
    <div className="a2-surface" data-surface={surfaceId}>
      <A2uiSurface surface={surface} />
    </div>
  ) : null;
}

/** Full snapshot messages for saving (built in this chunk so the main bundle stays light). */
export function buildSnapshot(suggestion: Suggestion, options: MomentRenderOptions, surfaceId: string) {
  return snapshotMessages(suggestion, options, Date.now(), surfaceId);
}
