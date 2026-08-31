export type AlertOwner = "foreground" | "background" | "handoff";

let owner: AlertOwner = "foreground";
let generation = 0;

export function setAlertOwner(next: AlertOwner): number {
  if (owner !== next) {
    owner = next;
    generation += 1;
  }
  return generation;
}

export function canDeliverForegroundAlert(): boolean {
  return owner === "foreground";
}

export function getAlertOwnershipGeneration(): number {
  return generation;
}

export function isCurrentAlertGeneration(expected: number): boolean {
  return generation === expected;
}