// Consistent-hashing ring (CLAUDE.md §7).
//
// Maps each `suggest:<prefix>` key to ONE of the physical Redis nodes. The
// point of consistent hashing (vs `hash % N`) is that adding/removing a node
// remaps only ~1/N of keys instead of nearly all of them — because a key only
// moves if the node that newly owns its arc changed.
//
// VIRTUAL NODES: each physical node is placed on the ring ~150 times (configurable).
// Without virtual nodes, 3 random points on the ring can carve very uneven arcs,
// so one node owns a huge share of the keyspace (hot-spotting). Spraying 150
// virtual points per node smooths the arc sizes toward uniform. This is the key
// viva point: virtual nodes -> balanced distribution + smooth rebalancing.
//
// Hash: MD5 truncated to 32 bits -> uniform spread over the ring space.
import crypto from 'node:crypto';

function hash32(str) {
  const digest = crypto.createHash('md5').update(str).digest();
  // First 4 bytes as an unsigned 32-bit integer = position on the ring.
  return digest.readUInt32BE(0);
}

export class ConsistentHashRing {
  // nodes: [{ id, host, port }, ...]
  constructor(nodes, virtualNodes = 150) {
    this.virtualNodes = virtualNodes;
    this.ring = []; // sorted array of { hash, node } points
    this.nodes = [];
    for (const node of nodes) this.addNode(node);
  }

  addNode(node) {
    this.nodes.push(node);
    for (let i = 0; i < this.virtualNodes; i++) {
      const point = hash32(`${node.id}#${i}`);
      this.ring.push({ hash: point, node });
    }
    this.ring.sort((a, b) => a.hash - b.hash);
  }

  removeNode(nodeId) {
    this.nodes = this.nodes.filter((n) => n.id !== nodeId);
    this.ring = this.ring.filter((p) => p.node.id !== nodeId);
  }

  // Given a key, find the first ring point clockwise from hash(key); that
  // point's node owns the key. Wraps around to ring[0] past the end.
  getNode(key) {
    if (this.ring.length === 0) return null;
    const h = hash32(key);
    // Binary search for the first ring point with hash >= h.
    let lo = 0;
    let hi = this.ring.length - 1;
    if (h > this.ring[hi].hash) return this.ring[0].node; // wrap
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.ring[mid].hash < h) lo = mid + 1;
      else hi = mid;
    }
    return this.ring[lo].node;
  }

  // Debug helper: how the keyspace is distributed across nodes (fraction of the
  // 2^32 ring each physical node owns). Used to demonstrate virtual-node balance.
  distribution() {
    const owned = {};
    for (const n of this.nodes) owned[n.id] = 0;
    const SPACE = 2 ** 32;
    for (let i = 0; i < this.ring.length; i++) {
      const cur = this.ring[i];
      const prev = this.ring[(i - 1 + this.ring.length) % this.ring.length];
      let arc = cur.hash - prev.hash;
      if (arc < 0) arc += SPACE; // wrap-around arc
      owned[cur.node.id] += arc;
    }
    const result = {};
    for (const n of this.nodes) result[n.id] = Number((owned[n.id] / SPACE).toFixed(4));
    return result;
  }
}
