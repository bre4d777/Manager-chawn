import Redis from "ioredis";
import { Rei, ReiT } from "#classes/rei";
import { logger } from "#utils";

/**
 * Dual-backend cache manager supporting Redis (with automatic fallback to in-memory)
 * or pure in-memory storage via {@link Rei}.
 *
 * All methods transparently route to whichever backend is active. Redis values are
 * JSON-serialised on write and deserialised on read; non-JSON strings are returned as-is.
 */
export class CacheManager {
  /**
   * @param {Object} config
   * @param {string} [config.type='memory'] - Primary backend: `'redis'` or `'memory'`.
   * @param {string} [config.fallback='memory'] - Fallback backend when Redis is unavailable.
   * @param {string} [config.url] - Redis connection URL (required when `type` is `'redis'`).
   * @param {number} [config.maxSize=50000] - Max entries for the in-memory store.
   * @param {boolean} [config.flushOnStart] - Clear cache on bot startup.
   * @param {boolean} [config.flushOnShutdown] - Clear cache on bot shutdown.
   */
  constructor(config) {
    this.config = config;
    this.type = config.type || "memory";
    this.fallbackType = config.fallback || "memory";
    this.redis = null;
    this.memory = new ReiT(config.maxSize || 50000);
    this.connected = false;
    this.useRedis = false;
    this.pipeline = null;
  }

  /**
   * Connects to Redis (if configured) and performs a ping to verify the connection.
   * Falls back to memory silently on failure.
   * @returns {Promise<this>}
   */
  async init() {
    if (this.type === "redis" && this.config.url) {
      try {
        this.redis = new Redis(this.config.url, {
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          lazyConnect: false,
          retryStrategy: (times) => {
            if (times > 3) {
              logger.error(
                "Cache",
                "Max Redis retries reached, using fallback",
              );
              this.useRedis = false;
              return null;
            }
            return Math.min(times * 200, 2000);
          },
        });

        this.redis.on("error", (err) => {
          logger.error("Cache", `Redis error: ${err.message}`);
          this.useRedis = false;
        });

        this.redis.on("connect", () => {
          this.connected = true;
          this.useRedis = true;
          logger.success("Cache", "Redis connected");
        });

        this.redis.on("close", () => {
          this.connected = false;
          this.useRedis = false;
          logger.warn("Cache", "Redis connection closed");
        });

        await this.redis.ping();
        logger.success("Cache", "Cache manager initialized with Redis");
      } catch (error) {
        logger.error("Cache", `Redis init failed: ${error.message}`);
        logger.warn("Cache", `Using ${this.fallbackType} fallback`);
        this.useRedis = false;
      }
    } else {
      logger.info("Cache", "Cache manager initialized with memory storage");
    }
    return this;
  }

  /**
   * Stores a key-value pair with an optional TTL.
   * @param {string} k
   * @param {*} v - Objects are JSON-serialised for Redis.
   * @param {number} [ttl] - Expiry in seconds.
   * @returns {Promise<boolean>} `false` if Redis write failed (value was saved to memory instead).
   */
  async set(k, v, ttl) {
    try {
      if (this.useRedis && this.connected) {
        const val = typeof v === "object" ? JSON.stringify(v) : String(v);
        if (ttl) {
          await this.redis.setex(k, ttl, val);
        } else {
          await this.redis.set(k, val);
        }
      } else {
        this.memory.set(k, v, ttl);
      }
      return true;
    } catch (error) {
      this.memory.set(k, v, ttl);
      return false;
    }
  }

  /**
   * Atomically sets a key only when it does not already exist, applying a TTL in the same step.
   *
   * - **Redis**: issues `SET key value NX EX ttl` which is a single atomic command.
   * - **Memory**: `has()` + `set()` is safe because Node.js is single-threaded;
   *   no other code can interleave between the two calls on the same microtask.
   *
   * @param {string} k
   * @param {*} v - Objects are JSON-serialised for Redis.
   * @param {number} ttl - Expiry in seconds.
   * @returns {Promise<boolean>} `true` if the key was set, `false` if it already existed.
   */
  async setnxex(k, v, ttl) {
    try {
      if (this.useRedis && this.connected) {
        const val = typeof v === "object" ? JSON.stringify(v) : String(v);
        const result = await this.redis.set(k, val, "NX", "EX", ttl);
        return result === "OK";
      }
      if (this.memory.has(k)) return false;
      this.memory.set(k, v, ttl);
      return true;
    } catch {
      if (this.memory.has(k)) return false;
      this.memory.set(k, v, ttl);
      return true;
    }
  }

  /**
   * @param {string} k @returns {Promise<*>} `null` if not found.
   */
  async get(k) {
    try {
      if (this.useRedis && this.connected) {
        const val = await this.redis.get(k);

        if (!val) return null;
        try {
          return JSON.parse(val);
        } catch {
          return val;
        }
      }
      return this.memory.get(k);
    } catch (error) {
      return this.memory.get(k);
    }
  }

  /**
   * @param {string} k @returns {Promise<boolean>}
   */
  async has(k) {
    try {
      if (this.useRedis && this.connected) {
        return (await this.redis.exists(k)) === 1;
      }
      return this.memory.has(k);
    } catch {
      return this.memory.has(k);
    }
  }

  /**
   * Deletes a key from both Redis and the in-memory store.
   * @param {string} k @returns {Promise<boolean>}
   */
  async del(k) {
    try {
      if (this.useRedis && this.connected) {
        await this.redis.del(k);
      }
      this.memory.del(k);
      return true;
    } catch {
      this.memory.del(k);
      return false;
    }
  }

  /**
   * Bulk-sets key-value pairs using a Redis pipeline for efficiency.
   * @param {Array<[string, *]>} arr @returns {Promise<boolean>}
   */
  async mset(arr) {
    try {
      if (this.useRedis && this.connected) {
        const pipe = this.redis.pipeline();
        for (const [k, v] of arr) {
          const val = typeof v === "object" ? JSON.stringify(v) : String(v);
          pipe.set(k, val);
        }
        await pipe.exec();
      }
      this.memory.mset(arr);
      return true;
    } catch {
      this.memory.mset(arr);
      return false;
    }
  }

  /**
   * Bulk-gets values. Missing keys return `null`.
   * @param {string[]} keys @returns {Promise<Array<*>>}
   */
  async mget(keys) {
    try {
      if (this.useRedis && this.connected) {
        const vals = await this.redis.mget(...keys);
        return vals.map((v) => {
          if (!v) return null;
          try {
            return JSON.parse(v);
          } catch {
            return v;
          }
        });
      }
      return this.memory.mget(keys);
    } catch {
      return this.memory.mget(keys);
    }
  }

  /**
   * Bulk-deletes keys. No-ops if `keys` is empty.
   * @param {string[]} keys @returns {Promise<boolean>}
   */
  async mdel(keys) {
    try {
      if (this.useRedis && this.connected) {
        if (keys.length > 0) await this.redis.del(...keys);
      }
      this.memory.mdel(keys);
      return true;
    } catch {
      this.memory.mdel(keys);
      return false;
    }
  }

  /**
   * Atomically increments a numeric value by `d`. Initialises to `d` if absent.
   * @param {string} k @param {number} [d=1] @returns {Promise<number>} New value.
   */
  async incr(k, d = 1) {
    try {
      if (this.useRedis && this.connected) {
        return await this.redis.incrby(k, d);
      }
      return this.memory.incr(k, d);
    } catch {
      return this.memory.incr(k, d);
    }
  }

  /**
   * Atomically decrements a numeric value by `d`.
   * @param {string} k @param {number} [d=1] @returns {Promise<number>} New value.
   */
  async decr(k, d = 1) {
    try {
      if (this.useRedis && this.connected) {
        return await this.redis.decrby(k, d);
      }
      return this.memory.decr(k, d);
    } catch {
      return this.memory.decr(k, d);
    }
  }

  /**
   * Lists all keys matching a glob-style pattern.
   * @param {string} [pattern='*'] @returns {Promise<string[]>}
   */
  async keys(pattern = "*") {
    try {
      if (this.useRedis && this.connected) {
        return await this.redis.keys(pattern);
      }
      return this.memory.keys(pattern);
    } catch {
      return this.memory.keys(pattern);
    }
  }

  // ─── Hash operations ──────────────────────────────────────────────────────────

  /**
   * Sets a field on a hash stored at `k`.
   * @param {string} k @param {string} f @param {*} v @returns {Promise<boolean>}
   */
  async hset(k, f, v) {
    try {
      if (this.useRedis && this.connected) {
        const val = typeof v === "object" ? JSON.stringify(v) : String(v);
        await this.redis.hset(k, f, val);
      } else {
        this.memory.hset(k, f, v);
      }
      return true;
    } catch {
      this.memory.hset(k, f, v);
      return false;
    }
  }

  /**
   * Gets a single field from a hash. Returns `null` if missing.
   * @param {string} k @param {string} f @returns {Promise<*>}
   */
  async hget(k, f) {
    try {
      if (this.useRedis && this.connected) {
        const val = await this.redis.hget(k, f);
        if (!val) return null;
        try {
          return JSON.parse(val);
        } catch {
          return val;
        }
      }
      return this.memory.hget(k, f);
    } catch {
      return this.memory.hget(k, f);
    }
  }

  /**
   * Deletes a field from a hash.
   * @param {string} k @param {string} f @returns {Promise<boolean>}
   */
  async hdel(k, f) {
    try {
      if (this.useRedis && this.connected) {
        await this.redis.hdel(k, f);
      }
      this.memory.hdel(k, f);
      return true;
    } catch {
      this.memory.hdel(k, f);
      return false;
    }
  }

  /**
   * Returns all fields and values of a hash. JSON fields are automatically deserialised.
   * @param {string} k @returns {Promise<Object>}
   */
  async hgetall(k) {
    try {
      if (this.useRedis && this.connected) {
        const obj = await this.redis.hgetall(k);
        const parsed = {};
        for (const [key, val] of Object.entries(obj)) {
          try {
            parsed[key] = JSON.parse(val);
          } catch {
            parsed[key] = val;
          }
        }
        return parsed;
      }
      return this.memory.hgetall(k);
    } catch {
      return this.memory.hgetall(k);
    }
  }

  /**
   * Merges multiple fields into a hash in a single call.
   * @param {string} k @param {Object} obj @returns {Promise<boolean>}
   */
  async hmset(k, obj) {
    try {
      if (this.useRedis && this.connected) {
        const serialized = {};
        for (const [key, val] of Object.entries(obj)) {
          serialized[key] =
            typeof val === "object" ? JSON.stringify(val) : String(val);
        }
        await this.redis.hset(k, serialized);
      }
      this.memory.hmset(k, obj);
      return true;
    } catch {
      this.memory.hmset(k, obj);
      return false;
    }
  }

  /**
   * Atomically increments a numeric hash field.
   * @param {string} k @param {string} f @param {number} [d=1] @returns {Promise<number>}
   */
  async hincrby(k, f, d = 1) {
    try {
      if (this.useRedis && this.connected) {
        return await this.redis.hincrby(k, f, d);
      }
      return this.memory.hincrby(k, f, d);
    } catch {
      return this.memory.hincrby(k, f, d);
    }
  }

  // ─── Set operations ───────────────────────────────────────────────────────────

  /**
   * Adds one or more members to the set at `k`.
   * @param {string} k @param {...*} members @returns {Promise<boolean>}
   */
  async sadd(k, ...members) {
    try {
      if (this.useRedis && this.connected) {
        await this.redis.sadd(k, ...members);
      }
      this.memory.sadd(k, ...members);
      return true;
    } catch {
      this.memory.sadd(k, ...members);
      return false;
    }
  }

  /**
   * @param {string} k @returns {Promise<Array<*>>}
   */
  async smembers(k) {
    try {
      if (this.useRedis && this.connected) {
        return await this.redis.smembers(k);
      }
      return this.memory.smembers(k);
    } catch {
      return this.memory.smembers(k);
    }
  }

  /**
   * @param {string} k @param {*} m @returns {Promise<boolean>}
   */
  async sismember(k, m) {
    try {
      if (this.useRedis && this.connected) {
        return (await this.redis.sismember(k, m)) === 1;
      }
      return this.memory.sismember(k, m);
    } catch {
      return this.memory.sismember(k, m);
    }
  }

  /**
   * Removes one or more members from the set at `k`.
   * @param {string} k @param {...*} members @returns {Promise<boolean>}
   */
  async srem(k, ...members) {
    try {
      if (this.useRedis && this.connected) {
        await this.redis.srem(k, ...members);
      }
      this.memory.srem(k, ...members);
      return true;
    } catch {
      this.memory.srem(k, ...members);
      return false;
    }
  }

  // ─── List operations ──────────────────────────────────────────────────────────

  /**
   * Prepends values to a list. Objects are JSON-serialised for Redis.
   * @param {string} k @param {...*} values @returns {Promise<number>} New list length.
   */
  async lpush(k, ...values) {
    try {
      if (this.useRedis && this.connected) {
        const serialized = values.map((v) =>
          typeof v === "object" ? JSON.stringify(v) : String(v),
        );
        return await this.redis.lpush(k, ...serialized);
      }
      return this.memory.lpush(k, ...values);
    } catch {
      return this.memory.lpush(k, ...values);
    }
  }

  /**
   * Appends values to a list. Objects are JSON-serialised for Redis.
   * @param {string} k @param {...*} values @returns {Promise<number>} New list length.
   */
  async rpush(k, ...values) {
    try {
      if (this.useRedis && this.connected) {
        const serialized = values.map((v) =>
          typeof v === "object" ? JSON.stringify(v) : String(v),
        );
        return await this.redis.rpush(k, ...serialized);
      }
      return this.memory.rpush(k, ...values);
    } catch {
      return this.memory.rpush(k, ...values);
    }
  }

  /**
   * Removes and returns the first element of a list.
   * @param {string} k @returns {Promise<*>} `null` if the list is empty or absent.
   */
  async lpop(k) {
    try {
      if (this.useRedis && this.connected) {
        const val = await this.redis.lpop(k);
        if (!val) return null;
        try {
          return JSON.parse(val);
        } catch {
          return val;
        }
      }
      return this.memory.lpop(k);
    } catch {
      return this.memory.lpop(k);
    }
  }

  /**
   * Removes and returns the last element of a list.
   * @param {string} k @returns {Promise<*>} `null` if the list is empty or absent.
   */
  async rpop(k) {
    try {
      if (this.useRedis && this.connected) {
        const val = await this.redis.rpop(k);
        if (!val) return null;
        try {
          return JSON.parse(val);
        } catch {
          return val;
        }
      }
      return this.memory.rpop(k);
    } catch {
      return this.memory.rpop(k);
    }
  }

  /**
   * Returns a slice of a list. JSON elements are automatically deserialised.
   * @param {string} k @param {number} start @param {number} stop @returns {Promise<Array<*>>}
   */
  async lrange(k, start, stop) {
    try {
      if (this.useRedis && this.connected) {
        const vals = await this.redis.lrange(k, start, stop);
        return vals.map((v) => {
          try {
            return JSON.parse(v);
          } catch {
            return v;
          }
        });
      }
      return this.memory.lrange(k, start, stop);
    } catch {
      return this.memory.lrange(k, start, stop);
    }
  }

  /**
   * @param {string} k @returns {Promise<number>} Length of the list, or 0 if absent.
   */
  async llen(k) {
    try {
      if (this.useRedis && this.connected) {
        return await this.redis.llen(k);
      }
      return this.memory.llen(k);
    } catch {
      return this.memory.llen(k);
    }
  }

  // ─── TTL / meta ───────────────────────────────────────────────────────────────

  /**
   * Sets an expiry on a key.
   * Delegates to the memory backend (ReiT) when Redis is unavailable.
   * @param {string} k @param {number} seconds @returns {Promise<boolean>}
   */
  async expire(k, seconds) {
    try {
      if (this.useRedis && this.connected) {
        return (await this.redis.expire(k, seconds)) === 1;
      }
      this.memory.expire(k, seconds);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns remaining TTL in seconds.
   * Delegates to the memory backend (ReiT.ttl()) when Redis is unavailable.
   * Returns `-1` if no expiry is set, `-2` if the key has already expired.
   * @param {string} k @returns {Promise<number>}
   */
  async ttl(k) {
    try {
      if (this.useRedis && this.connected) {
        return await this.redis.ttl(k);
      }
      return this.memory.ttl(k);
    } catch {
      return -1;
    }
  }

  /**
   * Returns the total number of keys in the active backend.
   * @returns {Promise<number>}
   */
  async size() {
    try {
      if (this.useRedis && this.connected) {
        return await this.redis.dbsize();
      }
      return this.memory.size;
    } catch {
      return this.memory.size;
    }
  }

  /**
   * Flushes all keys from both backends. Logs the action.
   * @returns {Promise<boolean>}
   */
  async clear() {
    try {
      if (this.useRedis && this.connected) {
        await this.redis.flushdb();
      }
      this.memory.clear();
      logger.info("Cache", "Cache cleared");
      return true;
    } catch {
      this.memory.clear();
      return false;
    }
  }

  /**
   * Measures Redis round-trip latency.
   * @returns {Promise<number>} Latency in ms, `0` if using memory, `-1` on error.
   */
  async ping() {
    try {
      if (this.useRedis && this.connected) {
        const start = Date.now();
        await this.redis.ping();
        return Date.now() - start;
      }
      return 0;
    } catch {
      return -1;
    }
  }

  /**
   * Gracefully closes the Redis connection and clears the in-memory store.
   * @returns {Promise<boolean>}
   */
  async disconnect() {
    try {
      if (this.redis && this.connected) {
        await this.redis.quit();
        this.connected = false;
        this.useRedis = false;
        logger.info("Cache", "Redis disconnected");
      }
      this.memory.clear();
      return true;
    } catch (error) {
      logger.error("Cache", `Disconnect error: ${error.message}`);
      return false;
    }
  }

  // ─── State getters ────────────────────────────────────────────────────────────

  /** `true` when Redis is the active backend. @type {boolean} */
  get isRedis() {
    return this.useRedis && this.connected;
  }

  /** `true` when the in-memory store is the active backend. @type {boolean} */
  get isMemory() {
    return !this.useRedis || !this.connected;
  }

  /**
   * Snapshot of the current backend state.
   * @type {{ type: 'redis'|'memory', connected: boolean, size: number }}
   */
  get status() {
    return {
      type: this.isRedis ? "redis" : "memory",
      connected: this.connected,
      size: this.memory.size,
    };
  }
}
