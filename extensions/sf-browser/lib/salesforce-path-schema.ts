/* SPDX-License-Identifier: Apache-2.0 */
/** TypeBox schema for structured Salesforce path routes. */
import { Type } from "typebox";

export const SalesforceRouteSchema = Type.Union([
  Type.Object({ type: Type.Literal("home") }),
  Type.Object({
    type: Type.Literal("setup"),
    destination: Type.String({
      description: "Curated Setup Destination, such as setup-home, agentforce-agents, or users.",
    }),
  }),
  Type.Object({
    type: Type.Literal("object-list"),
    objectApiName: Type.String({ description: "Salesforce object API name, such as Account." }),
  }),
  Type.Object({
    type: Type.Literal("object-new"),
    objectApiName: Type.String({ description: "Salesforce object API name, such as Account." }),
  }),
  Type.Object({
    type: Type.Literal("record-view"),
    objectApiName: Type.String({ description: "Salesforce object API name, such as Account." }),
    recordId: Type.String({ description: "15 or 18 character Salesforce record id." }),
  }),
]);
