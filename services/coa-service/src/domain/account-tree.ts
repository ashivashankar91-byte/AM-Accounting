// S211 — Account hierarchy domain logic (single-parent tree).
// Pure functions over a flat account list; no I/O.

export const MAX_TREE_DEPTH = 6; // BR211 — depth guard (root = level 1)

export interface TreeAccount {
  id: string;
  parentId: string | null;
  accountNumber: string;
  name: string;
  type: string;
  normalBalance: string;
  postable: boolean;
  status: string;
}

export interface TreeNode extends TreeAccount {
  children: TreeNode[];
}

/** Index accounts by id. */
function byId(accounts: TreeAccount[]): Map<string, TreeAccount> {
  return new Map(accounts.map((a) => [a.id, a]));
}

/**
 * BR211-1 — would setting `accountId`'s parent to `newParentId` create a cycle?
 * True when newParentId is the account itself or any of its descendants.
 * Implemented by walking UP from newParentId: if we reach accountId, it is an
 * ancestor of newParentId, so newParentId is a descendant → cycle.
 */
export function wouldCreateCycle(
  accountId: string,
  newParentId: string | null,
  accounts: TreeAccount[],
): boolean {
  if (newParentId === null) return false;
  if (newParentId === accountId) return true;
  const index = byId(accounts);
  let cursor: string | null | undefined = newParentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === accountId) return true;
    if (seen.has(cursor)) break; // pre-existing cycle guard
    seen.add(cursor);
    cursor = index.get(cursor)?.parentId ?? null;
  }
  return false;
}

/** Depth of a node counting from root = 1 (following current parent links). */
export function depthOf(accountId: string, accounts: TreeAccount[]): number {
  const index = byId(accounts);
  let depth = 1;
  let cursor: string | null | undefined = index.get(accountId)?.parentId ?? null;
  const seen = new Set<string>();
  while (cursor) {
    depth += 1;
    if (seen.has(cursor)) break;
    seen.add(cursor);
    cursor = index.get(cursor)?.parentId ?? null;
  }
  return depth;
}

/** Height of the subtree rooted at accountId (a leaf has height 0). */
export function subtreeHeight(accountId: string, accounts: TreeAccount[]): number {
  const childrenOf = new Map<string, string[]>();
  for (const a of accounts) {
    if (a.parentId) {
      const arr = childrenOf.get(a.parentId) ?? [];
      arr.push(a.id);
      childrenOf.set(a.parentId, arr);
    }
  }
  const walk = (id: string, guard: Set<string>): number => {
    if (guard.has(id)) return 0;
    guard.add(id);
    const kids = childrenOf.get(id) ?? [];
    if (kids.length === 0) return 0;
    return 1 + Math.max(...kids.map((k) => walk(k, guard)));
  };
  return walk(accountId, new Set<string>());
}

/**
 * Deepest level any node in `accountId`'s subtree would occupy if it were
 * re-parented under `newParentId`. Root = level 1.
 */
export function projectedMaxDepth(
  accountId: string,
  newParentId: string | null,
  accounts: TreeAccount[],
): number {
  const newDepth = newParentId === null ? 1 : depthOf(newParentId, accounts) + 1;
  return newDepth + subtreeHeight(accountId, accounts);
}

/** Build a nested tree (roots first), children ordered by account number. */
export function buildTree(accounts: TreeAccount[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  for (const a of accounts) nodes.set(a.id, { ...a, children: [] });
  const roots: TreeNode[] = [];
  for (const node of nodes.values()) {
    if (node.parentId && nodes.has(node.parentId)) {
      nodes.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortRec = (list: TreeNode[]) => {
    list.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
    for (const n of list) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}
