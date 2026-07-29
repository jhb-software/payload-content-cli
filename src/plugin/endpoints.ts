/**
 * Endpoint metadata capture for the content-cli plugin.
 *
 * Payload lets an endpoint carry anything under `custom`; the CLI reads a
 * documented subset of it (see `EndpointCustom`) so `discover` can describe
 * custom endpoints. Everything else is ignored, and a `custom` of the wrong
 * shape degrades to no metadata rather than breaking the schema response.
 *
 * Internal: consumers describe endpoints by writing `custom`, not by calling
 * this.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { EndpointSchema } from "../schema-contract.js";

/** Extract optional CLI metadata from an endpoint's `custom` property. */
export function extractEndpointMeta(custom: any): Pick<EndpointSchema, "description" | "schema"> {
  if (!custom || typeof custom !== "object") return {};
  const meta: Pick<EndpointSchema, "description" | "schema"> = {};
  if (typeof custom.description === "string") meta.description = custom.description;
  if (custom.schema && typeof custom.schema === "object") {
    const schema: NonNullable<EndpointSchema["schema"]> = {};
    if (custom.schema.query && typeof custom.schema.query === "object")
      schema.query = custom.schema.query;
    if (custom.schema.body && typeof custom.schema.body === "object")
      schema.body = custom.schema.body;
    if (custom.schema.response && typeof custom.schema.response === "object")
      schema.response = custom.schema.response;
    if (Object.keys(schema).length > 0) meta.schema = schema;
  }
  return meta;
}
