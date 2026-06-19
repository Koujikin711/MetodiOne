import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DraggableAttributes } from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";

import { GripVertical } from "@/components/icons";
import { ShellNavLink } from "@/components/ShellNavLink";
import type { ShellSidebarIconKey } from "@/lib/shellSidebarNavItems";
import type { NavIconVariant } from "@/components/GradientIconBox";

type Props = {
  id: string;
  to: string;
  end?: boolean;
  title: string;
  labelShort: string;
  labelFull: string;
  variant?: NavIconVariant;
  iconKey: ShellSidebarIconKey;
  expanded: boolean;
};

export function SortableShellNavLink(props: Props) {
  const { id, expanded, ...linkProps } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 30 : undefined,
  };

  const dragHandleProps = {
    attributes: attributes as DraggableAttributes,
    listeners: listeners as SyntheticListenerMap | undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={["shell-nav-sortable", isDragging ? "is-dragging" : ""].filter(Boolean).join(" ")}
    >
      <ShellNavLink {...linkProps} expanded={expanded} dragHandleProps={expanded ? undefined : dragHandleProps} />
      <button
        type="button"
        className="shell-nav-drag-handle"
        aria-label="Переместить пункт меню"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
