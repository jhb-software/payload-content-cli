import type { Access, AccessArgs, CollectionConfig } from "payload";

const isAdmin: Access = ({ req }) => {
  return req.user?.collection === "users" && req.user?.role === "admin";
};

const isSelf: Access = ({ req: { user }, id }): boolean => {
  return Boolean(user && user.id === id);
};

const isSelfOrAdmin: Access = ({ req, id }): boolean => {
  return Boolean(isSelf({ req, id }) || isAdmin({ req }));
};

export const ApiKeys: CollectionConfig = {
  slug: "api-keys",
  auth: { useAPIKey: true, disableLocalStrategy: true },
  admin: { useAsTitle: "name" },
  access: {
    create: isAdmin,
    read: isSelfOrAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  fields: [{ name: "name", type: "text", required: true }],
};
