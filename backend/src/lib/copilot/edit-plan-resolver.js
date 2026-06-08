export function createEditPlanResolver({ buildEditPlan } = {}) {
  return function buildEditPlanFromInstruction(args = {}) {
    const semanticInstruction = args.semanticInstruction || args.validatedInstruction || args.instruction || null

    if (semanticInstruction) {
      return buildEditPlan({
        ...args,
        semanticInstruction,
      })
    }

    return buildEditPlan(args)
  }
}
