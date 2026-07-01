import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useMemo } from "react";

import { SortableShellNavLink } from "@/components/SortableShellNavLink";
import { useShellSidebarOrder } from "@/hooks/useShellSidebarOrder";
import { buildShellSidebarNavItems } from "@/lib/shellSidebarNavItems";
import { appLexicon } from "@/lib/appLexicon";

type Props = {
  expanded: boolean;
  scope: string;
  isSuperOwner: boolean;
  isManagerNav: boolean;
  isExpert: boolean;
  isChiefExpert: boolean;
  showServices: boolean;
  showFinance: boolean;
  showIntegrationsHub: boolean;
  showKpi: boolean;
  showNavForFeature: (feature: string) => boolean;
};

export function ShellSidebarNav({
  expanded,
  scope,
  isSuperOwner,
  isManagerNav,
  isExpert,
  isChiefExpert,
  showServices,
  showFinance,
  showIntegrationsHub,
  showKpi,
  showNavForFeature,
}: Props) {
  const items = useMemo(
    () =>
      buildShellSidebarNavItems({
        isSuperOwner,
        isManagerNav,
        isExpert,
        isChiefExpert,
        showServices,
        showFinance,
        showIntegrationsHub,
        showKpi,
        showNavForFeature,
        navLex: appLexicon,
      }),
    [
      isSuperOwner,
      isManagerNav,
      isExpert,
      isChiefExpert,
      showServices,
      showFinance,
      showIntegrationsHub,
      showKpi,
      showNavForFeature,
    ],
  );

  const { orderedItems, order, reorder } = useShellSidebarOrder(scope, items);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    reorder(String(active.id), String(over.id));
  }

  if (!orderedItems.length) return null;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        {orderedItems.map((item) => (
          <SortableShellNavLink
            key={item.id}
            id={item.id}
            to={item.to}
            end={item.end}
            title={item.title}
            labelShort={item.labelShort}
            labelFull={item.labelFull}
            variant={item.variant}
            iconKey={item.iconKey}
            expanded={expanded}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}
