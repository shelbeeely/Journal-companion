import { useEffect, useMemo, useRef } from 'react';
import { MessageProcessor, type SurfaceModel } from '@a2ui/web_core/v0_9';
import { A2uiSurface } from '@a2ui/react/v0_9';
import { DeskAgent, SURFACES, type A2uiMessage, type DeskSurfaceInput, type SurfaceId } from '../core/a2ui/deskAgent';
import type { TaskComposition } from '../core/insights';
import { deskCatalog } from './deskCatalog';

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
