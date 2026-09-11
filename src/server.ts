import express, { Request, Response } from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { exec } from "child_process";
import dotenv from "dotenv";
import Discord, {
  Client,
  Guild,
  TextChannel,
  VoiceChannel,
  CategoryChannel,
  OverwriteData,
  GuildChannelCreateOptions
} from "discord.js-selfbot-v13";
import backup from "./src/index";
import * as utilMaster from "./src/util";
import * as loadMaster from "./src/load";

dotenv.config();

// Prevent unhandled errors from crashing the Express server
process.on("uncaughtException", (err) => {
  console.error("Unhandled Exception:", err.message);
});
process.on("unhandledRejection", (reason: any) => {
  console.error("Unhandled Rejection:", reason?.message || reason);
});

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

let discordClient: Client | null = null;
let currentToken: string = process.env.TOKEN || "";
let isCloning = false;
let cancelRequested = false;

// SSE Clients for real-time progress streaming
const sseClients: Response[] = [];

function broadcast(event: string, data: any) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((client) => {
    try {
      client.write(payload);
    } catch {}
  });
}

function broadcastLog(message: string, level: "info" | "success" | "warning" | "error" = "info") {
  const time = new Date().toLocaleTimeString();
  broadcast("log", { time, message, level });
}

function broadcastProgress(percent: number, phase: string, detail?: string) {
  broadcast("progress", { percent, phase, detail });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Safe API caller with automatic 429 rate limit backoff and retry
async function safeApiCall<T>(fn: () => Promise<T>, maxRetries = 4, baseDelay = 400): Promise<T> {
  let attempt = 0;
  while (attempt < maxRetries) {
    if (cancelRequested) {
      throw new Error("Cloning cancelled by user.");
    }
    try {
      const result = await fn();
      await sleep(baseDelay);
      return result;
    } catch (err: any) {
      attempt++;
      if (cancelRequested) throw new Error("Cloning cancelled by user.");

      const isRateLimit =
        err.status === 429 ||
        err.code === 429 ||
        err.message?.toLowerCase().includes("rate limit") ||
        err.message?.toLowerCase().includes("too many requests");

      if (isRateLimit) {
        const retryAfter = (err.retryAfter ? err.retryAfter * 1000 : 2500) * attempt;
        broadcastLog(`⏳ Discord rate limit encountered. Waiting ${(retryAfter / 1000).toFixed(1)}s before retrying...`, "warning");
        await sleep(retryAfter);
      } else if (attempt >= maxRetries) {
        throw err;
      } else {
        await sleep(800 * attempt);
      }
    }
  }
  throw new Error("Maximum retries exceeded.");
}

// Check status endpoint
app.get("/api/status", (req: Request, res: Response) => {
  const loggedIn = !!discordClient?.user;
  res.json({
    loggedIn,
    hasSavedToken: !!process.env.TOKEN,
    user: loggedIn && discordClient?.user ? {
      id: discordClient.user.id,
      username: discordClient.user.username,
      globalName: discordClient.user.globalName || discordClient.user.username,
      avatar: discordClient.user.avatarURL({ dynamic: true, size: 256 }) || "https://cdn.discordapp.com/embed/avatars/0.png",
      banner: discordClient.user.bannerURL({ dynamic: true }) || null,
      guildCount: discordClient.guilds.cache.size,
    } : null,
    isCloning,
  });
});

// SSE live events endpoint
app.get("/api/events", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  sseClients.push(res);
  res.write(`event: connected\ndata: ${JSON.stringify({ status: "connected" })}\n\n`);

  req.on("close", () => {
    const idx = sseClients.indexOf(res);
    if (idx !== -1) sseClients.splice(idx, 1);
  });
});

// Login endpoint
app.post("/api/login", async (req: Request, res: Response) => {
  let token = req.body.token || process.env.TOKEN;
  const remember = !!req.body.remember;

  if (!token || typeof token !== "string" || !token.trim()) {
    return res.status(400).json({ error: "Please provide a valid Discord user token." });
  }

  // Clean token from surrounding quotes or accidental "Bot " prefix
  // Pre-validate token via Discord REST API for instant feedback
  try {
    const resAuth = await fetch("https://discord.com/api/v9/users/@me", {
      headers: { Authorization: token },
    });
    const authData: any = await resAuth.json().catch(() => ({}));
    if (resAuth.status === 401) {
      return res.status(401).json({
        error: "Discord rejected this token (401 Unauthorized). The token is invalid or expired. Please obtain a fresh User Account Token from your browser's Discord Developer Tools."
      });
    }
    if (resAuth.status === 403) {
      return res.status(403).json({
        error: `Discord account restricted (403 Forbidden): ${authData.message || "Action not allowed. Your account may require verification."}`
      });
    }
    if (authData.bot) {
      return res.status(400).json({
        error: "This is a Discord BOT token. The cloner requires a personal User Account token (selfbot), not a Bot token."
      });
    }
  } catch (netErr: any) {
    console.warn("Pre-auth check network warning:", netErr?.message);
  }

  try {
    if (discordClient) {
      try { discordClient.destroy(); } catch {}
      discordClient = null;
    }

    const client = new Client({
      partials: [],
    });

    client.on("error", (err) => {
      console.error("Discord client socket error:", err.message);
    });

    await new Promise<void>((resolve, reject) => {
      let isSettled = false;
      const done = (err?: Error) => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      };

      const timer = setTimeout(() => {
        done(new Error("Login timed out after 20 seconds. Discord gateway did not respond. Check your internet connection or proxy settings."));
      }, 20000);

      client.once("ready", () => {
        done();
      });

      client.on("shardDisconnect", (event: any) => {
        if (event?.code === 4004) {
          done(new Error("Authentication failed (Code 4004): Token invalid or reset by Discord."));
        } else if (event?.code === 4000 || event?.code === 4001) {
          done(new Error(`Connection closed by Discord (Code ${event.code}): Gateway rejected session.`));
        }
      });

      client.login(token).catch((err) => {
        done(err);
      });
    });

    discordClient = client;
    currentToken = token;

    if (remember) {
      try {
        const envPath = path.join(__dirname, "../.env");
        fs.writeFileSync(envPath, `TOKEN=${currentToken}\n`, "utf8");
        process.env.TOKEN = currentToken;
      } catch (err) {
        console.error("Failed to write token to .env:", err);
      }
    }

    // Initial fetch of guilds
    await client.guilds.fetch().catch(() => {});

    res.json({
      success: true,
      user: {
        id: client.user?.id,
        username: client.user?.username,
        globalName: client.user?.globalName || client.user?.username,
        avatar: client.user?.avatarURL({ dynamic: true, size: 256 }) || "https://cdn.discordapp.com/embed/avatars/0.png",
        banner: client.user?.bannerURL({ dynamic: true }) || null,
        guildCount: client.guilds.cache.size,
      }
    });
  } catch (error: any) {
    let msg = error.message || "Failed to log in to Discord";
    if (
      msg.includes("An invalid token was provided") ||
      msg.includes("TOKEN_INVALID") ||
      msg.includes("4004") ||
      msg.includes("Authentication failed")
    ) {
      msg = "Discord rejected this token (401 Unauthorized). Ensure you copied your personal Discord User Token (not a Bot token) from your browser DevTools.";
    }
    res.status(401).json({ error: msg });
  }
});

// Logout endpoint
app.post("/api/logout", (req: Request, res: Response) => {
  if (discordClient) {
    try { discordClient.destroy(); } catch {}
    discordClient = null;
  }
  res.json({ success: true });
});

// Inspect a single guild by ID (manual lookup)
app.get("/api/guilds/lookup/:id", async (req: Request, res: Response) => {
  if (!discordClient || !discordClient.user) {
    return res.status(401).json({ error: "Not logged in" });
  }

  const guildId = String(req.params.id || "").trim();
  try {
    let guild = discordClient.guilds.cache.get(guildId);
    if (!guild) {
      guild = await discordClient.guilds.fetch(guildId);
    }

    if (!guild) {
      return res.status(404).json({ error: "Server not found. Your account must be a member of this server." });
    }

    let hasAdmin = guild.ownerId === discordClient.user.id;
    if (!hasAdmin) {
      const me = guild.me || (await guild.members.fetch(discordClient.user.id).catch((): any => null));
      hasAdmin = !!(
        me?.permissions?.has("ADMINISTRATOR") ||
        me?.permissions?.has("MANAGE_GUILD")
      );
    }

    res.json({
      guild: {
        id: guild.id,
        name: guild.name,
        icon: guild.iconURL({ dynamic: true, size: 128 }) || null,
        memberCount: guild.memberCount || 0,
        hasAdmin,
        isOwner: guild.ownerId === discordClient.user.id,
      }
    });
  } catch (err: any) {
    res.status(404).json({ error: `Could not fetch server: ${err.message}` });
  }
});

// Get user guilds list
app.get("/api/guilds", async (req: Request, res: Response) => {
  if (!discordClient || !discordClient.user) {
    return res.status(401).json({ error: "Not logged in" });
  }

  try {
    await discordClient.guilds.fetch().catch(() => {});
    const guilds = [];

    for (const [id, guild] of discordClient.guilds.cache) {
      let isOwner = guild.ownerId === discordClient.user.id;
      let hasAdmin = isOwner;

      if (!hasAdmin) {
        const me = guild.me || guild.members.cache.get(discordClient.user.id);
        if (me) {
          hasAdmin = !!(
            me.permissions?.has("ADMINISTRATOR") ||
            me.permissions?.has("MANAGE_GUILD")
          );
        }
      }

      guilds.push({
        id: guild.id,
        name: guild.name,
        icon: guild.iconURL({ dynamic: true, size: 128 }) || null,
        memberCount: guild.memberCount || 0,
        hasAdmin,
        isOwner,
      });
    }

    // Sort alphabetically by name
    guilds.sort((a, b) => a.name.localeCompare(b.name));

    res.json({ guilds });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to fetch servers" });
  }
});

// Abort/Cancel active clone job
app.post("/api/clone/abort", (req: Request, res: Response) => {
  if (!isCloning) {
    return res.json({ message: "No active clone job to cancel." });
  }
  cancelRequested = true;
  broadcastLog("🛑 Cancellation requested by user. Finishing current operation...", "warning");
  res.json({ success: true, message: "Cancellation initiated." });
});

// Start cloning
app.post("/api/clone", async (req: Request, res: Response) => {
  if (!discordClient || !discordClient.user) {
    return res.status(401).json({ error: "Not logged in" });
  }

  if (isCloning) {
    return res.status(409).json({ error: "A clone job is already in progress. Please wait or cancel it." });
  }

  const {
    sourceGuildId,
    targetMode, // 'new' | 'existing' | 'template'
    targetGuildId,
    newServerName,
    clearTargetServer = true,
    cloneRoles = true,
    cloneChannels = true,
    clonePermissions = true,
    cloneEmojis = true,
    maxMessages = 0,
    saveJson = false,
  } = req.body;

  if (!sourceGuildId || typeof sourceGuildId !== "string") {
    return res.status(400).json({ error: "Source server ID is required." });
  }

  if (targetMode === "existing" && (!targetGuildId || typeof targetGuildId !== "string")) {
    return res.status(400).json({ error: "Destination server ID is required for existing server mode." });
  }

  // Verify source server exists
  let sourceGuild = discordClient.guilds.cache.get(sourceGuildId.trim());
  if (!sourceGuild) {
    try {
      sourceGuild = await discordClient.guilds.fetch(sourceGuildId.trim());
    } catch {}
  }

  if (!sourceGuild) {
    return res.status(404).json({ error: "Source server not found. Ensure your account is a member of that server." });
  }

  // Verify target server if existing mode
  if (targetMode === "existing") {
    let targetGuild = discordClient.guilds.cache.get(targetGuildId.trim());
    if (!targetGuild) {
      try {
        targetGuild = await discordClient.guilds.fetch(targetGuildId.trim());
      } catch {}
    }

    if (!targetGuild) {
      return res.status(404).json({ error: "Destination server not found." });
    }
  }

  cancelRequested = false;
  isCloning = true;

  res.json({ success: true, message: "Cloning process started." });

  // Execute pipeline
  runCloningPipeline({
    sourceGuild,
    targetMode,
    targetGuildId: targetGuildId ? targetGuildId.trim() : undefined,
    newServerName: newServerName?.trim(),
    clearTargetServer: !!clearTargetServer,
    cloneRoles: !!cloneRoles,
    cloneChannels: !!cloneChannels,
    clonePermissions: !!clonePermissions,
    cloneEmojis: !!cloneEmojis,
    maxMessages: Number(maxMessages) || 0,
    saveJson: !!saveJson,
  });
});

interface PipelineConfig {
  sourceGuild: Guild;
  targetMode: "new" | "existing" | "template";
  targetGuildId?: string;
  newServerName?: string;
  clearTargetServer: boolean;
  cloneRoles: boolean;
  cloneChannels: boolean;
  clonePermissions: boolean;
  cloneEmojis: boolean;
  maxMessages: number;
  saveJson: boolean;
}

async function runCloningPipeline(cfg: PipelineConfig) {
  const startTime = Date.now();
  let errorsCount = 0;
  let targetGuild: Guild | null = null;
  let rolesCreated = 0;
  let channelsCreated = 0;
  let emojisCreated = 0;

  try {
    broadcastLog(`🚀 Starting clone pipeline for: "${cfg.sourceGuild.name}" (${cfg.sourceGuild.id})`, "info");
    broadcastProgress(5, "Analyzing source server...", "Fetching server data");

    // 1. Export backup from source server
    const doNotBackup: string[] = [];
    if (!cfg.cloneRoles) doNotBackup.push("roles");
    if (!cfg.cloneChannels) doNotBackup.push("channels");
    if (!cfg.cloneEmojis) doNotBackup.push("emojis");

    broadcastLog(`📦 Backing up server configuration, channels, and roles...`, "info");
    broadcastProgress(15, "Exporting server components...", "Reading roles, channels and settings");

    const backupData = await backup.create(cfg.sourceGuild, {
      backupID: `cloner_${Date.now()}`,
      maxMessagesPerChannel: cfg.maxMessages,
      jsonSave: cfg.saveJson,
      jsonBeautify: true,
      doNotBackup,
      saveImages: "base64",
    });

    const totalCategories = backupData.channels.categories.length;
    const totalChannels = totalCategories + backupData.channels.others.length +
      backupData.channels.categories.reduce((acc, c) => acc + c.children.length, 0);
    const totalRoles = backupData.roles.length;
    const totalEmojis = backupData.emojis.length;

    broadcastLog(`✅ Backup captured: ${totalRoles} roles, ${totalChannels} channels, ${totalEmojis} emojis`, "success");

    // 2. Prepare Destination Server
    broadcastProgress(30, "Preparing destination server...", "Setting up target server");

    if (cfg.targetMode === "existing") {
      targetGuild = discordClient!.guilds.cache.get(cfg.targetGuildId!) || (await discordClient!.guilds.fetch(cfg.targetGuildId!));
      if (!targetGuild) {
        throw new Error("Could not access destination server.");
      }

      if (cfg.clearTargetServer) {
        broadcastLog(`🧹 Clearing existing channels and roles from "${targetGuild.name}"...`, "warning");
        broadcastProgress(35, "Wiping target server channels...", "Deleting existing channels");

        // Clear channels safely
        for (const channel of targetGuild.channels.cache.values()) {
          if (cancelRequested) break;
          try {
            await safeApiCall(() => (channel as any).delete(), 2, 200);
          } catch (err: any) {
            broadcastLog(`Notice: Channel deletion failed (${channel.name}): ${err.message}`, "warning");
          }
        }

        // Clear custom roles safely (except @everyone and managed bot roles)
        for (const role of targetGuild.roles.cache.values()) {
          if (cancelRequested) break;
          if (role.id === targetGuild.id || role.managed) continue;
          try {
            await safeApiCall(() => role.delete(), 2, 200);
          } catch {}
        }
      }
    } else {
      // Create new server
      const nameToUse = cfg.newServerName || `${cfg.sourceGuild.name} (Clone)`;
      broadcastLog(`✨ Creating new server: "${nameToUse}"...`, "info");
      broadcastProgress(35, "Creating new Discord server...", nameToUse);

      try {
        targetGuild = await safeApiCall(() =>
          discordClient!.guilds.create(nameToUse, {
            icon: cfg.sourceGuild.iconURL({ dynamic: false }) || undefined,
          }), 3, 1000
        );
        broadcastLog(`✅ New server created with ID: ${targetGuild.id}`, "success");
      } catch (err: any) {
        if (err.message?.includes("100") || err.message?.includes("Maximum number of guilds")) {
          throw new Error("Maximum Discord server limit reached on this account (100 servers). Please use an existing server or leave unused servers.");
        }
        throw err;
      }
    }

    if (!targetGuild) {
      throw new Error("Failed to prepare destination server.");
    }

    // 3. Configure Basic Server Settings
    broadcastProgress(45, "Applying server settings...", "Setting name, icon, banner");
    broadcastLog(`⚙️ Applying server name, icons and verification settings...`, "info");
    try {
      await loadMaster.loadConfig(targetGuild, backupData);
    } catch (err: any) {
      broadcastLog(`Notice: Some server settings could not be applied: ${err.message}`, "warning");
    }

    // Role mapping for permission restoration
    const roleMap = new Map<string, string>(); // roleName -> newRoleId

    // 4. Restore Roles (Sequential with rate limit protection)
    if (cfg.cloneRoles && totalRoles > 0) {
      broadcastProgress(50, "Cloning roles & permissions...", `0 / ${totalRoles} roles`);
      broadcastLog(`🛡️ Restoring ${totalRoles} roles in correct order...`, "info");

      // Handle @everyone role
      const everyoneRoleData = backupData.roles.find((r) => r.isEveryone);
      if (everyoneRoleData) {
        const everyoneRole = targetGuild.roles.everyone;
        if (everyoneRole) {
          try {
            await safeApiCall(() =>
              everyoneRole.edit({
                permissions: BigInt(everyoneRoleData.permissions),
              }), 2, 300
            );
            roleMap.set("@everyone", everyoneRole.id);
          } catch {}
        }
      }

      // Create other roles from lowest to highest
      const regularRoles = backupData.roles.filter((r) => !r.isEveryone);
      for (let i = 0; i < regularRoles.length; i++) {
        if (cancelRequested) break;
        const roleData = regularRoles[i];

        try {
          const newRole = await safeApiCall(() =>
            targetGuild!.roles.create({
              name: roleData.name,
              color: roleData.color,
              hoist: roleData.hoist,
              permissions: BigInt(roleData.permissions),
              mentionable: roleData.mentionable,
            }), 3, 350
          );

          roleMap.set(roleData.name, newRole.id);
          rolesCreated++;
          broadcastLog(`  [Role ${rolesCreated}/${regularRoles.length}] Created: "${roleData.name}"`, "info");
          broadcastProgress(50 + Math.floor((i / regularRoles.length) * 15), "Cloning roles...", `${rolesCreated}/${regularRoles.length} created`);
        } catch (err: any) {
          errorsCount++;
          broadcastLog(`  Failed to create role "${roleData.name}": ${err.message}`, "error");
        }
      }
      broadcastLog(`✅ Created ${rolesCreated} roles.`, "success");
    }

    // 5. Restore Categories & Channels (Sequential with permission sync)
    if (cfg.cloneChannels && totalChannels > 0) {
      broadcastProgress(68, "Cloning channels & categories...", `0 / ${totalChannels} channels`);
      broadcastLog(`📁 Creating categories and channels...`, "info");

      // Function to build permission overwrites mapped to new role IDs
      const buildOverwrites = (perms: any[] = []): OverwriteData[] => {
        if (!cfg.clonePermissions) return [];
        const overwrites: OverwriteData[] = [];
        for (const p of perms) {
          let roleId = p.roleName === "@everyone" ? targetGuild!.roles.everyone.id : roleMap.get(p.roleName);
          if (roleId) {
            overwrites.push({
              id: roleId,
              allow: BigInt(p.allow),
              deny: BigInt(p.deny),
              type: "role",
            });
          }
        }
        return overwrites;
      };

      // 5a. Categories and their children
      for (const catData of backupData.channels.categories) {
        if (cancelRequested) break;
        let createdCategory: CategoryChannel | undefined;

        try {
          createdCategory = (await safeApiCall(
            () => targetGuild!.channels.create(catData.name, {
              type: "GUILD_CATEGORY",
              permissionOverwrites: buildOverwrites(catData.permissions),
            }) as any, 3, 400
          )) as CategoryChannel;

          channelsCreated++;
          broadcastLog(`  [Category] Created: "${catData.name}"`, "info");
        } catch (err: any) {
          errorsCount++;
          broadcastLog(`  Failed to create category "${catData.name}": ${err.message}`, "error");
        }

        // Child channels inside category
        for (const chData of catData.children) {
          if (cancelRequested) break;
          try {
            const isText = chData.type === "GUILD_TEXT" || chData.type === "GUILD_NEWS";
            const channelType = isText ? "GUILD_TEXT" : "GUILD_VOICE";

            await safeApiCall(() =>
              targetGuild!.channels.create(chData.name, {
                type: channelType,
                parent: createdCategory ? createdCategory.id : undefined,
                topic: (chData as any).topic || undefined,
                nsfw: (chData as any).nsfw || false,
                rateLimitPerUser: (chData as any).rateLimitPerUser || 0,
                bitrate: (chData as any).bitrate || undefined,
                permissionOverwrites: buildOverwrites(chData.permissions),
              }), 3, 400
            );

            channelsCreated++;
            broadcastLog(`    [${channelType === "GUILD_TEXT" ? "#" : "🔊"}] Created: "${chData.name}"`, "info");
            broadcastProgress(68 + Math.floor((channelsCreated / totalChannels) * 18), "Cloning channels...", `${channelsCreated}/${totalChannels}`);
          } catch (err: any) {
            errorsCount++;
            broadcastLog(`    Failed to create channel "${chData.name}": ${err.message}`, "error");
          }
        }
      }

      // 5b. Channels outside categories
      for (const chData of backupData.channels.others) {
        if (cancelRequested) break;
        try {
          const isText = chData.type === "GUILD_TEXT" || chData.type === "GUILD_NEWS";
          const channelType = isText ? "GUILD_TEXT" : "GUILD_VOICE";

          await safeApiCall(() =>
            targetGuild!.channels.create(chData.name, {
              type: channelType,
              topic: (chData as any).topic || undefined,
              nsfw: (chData as any).nsfw || false,
              rateLimitPerUser: (chData as any).rateLimitPerUser || 0,
              bitrate: (chData as any).bitrate || undefined,
              permissionOverwrites: buildOverwrites(chData.permissions),
            }), 3, 400
          );

          channelsCreated++;
          broadcastLog(`  [${channelType === "GUILD_TEXT" ? "#" : "🔊"}] Created: "${chData.name}"`, "info");
        } catch (err: any) {
          errorsCount++;
          broadcastLog(`  Failed to create channel "${chData.name}": ${err.message}`, "error");
        }
      }

      broadcastLog(`✅ Created ${channelsCreated} channels and categories.`, "success");
    }

    // 6. Restore Emojis (Capped to 50 to prevent Discord quota rejection)
    if (cfg.cloneEmojis && totalEmojis > 0) {
      const emojiLimit = Math.min(totalEmojis, 50);
      broadcastProgress(88, "Uploading emojis...", `0 / ${emojiLimit} emojis`);
      broadcastLog(`🎨 Uploading up to ${emojiLimit} emojis...`, "info");

      for (let i = 0; i < emojiLimit; i++) {
        if (cancelRequested) break;
        const emojiData = backupData.emojis[i];

        try {
          const imgSource = emojiData.url || (emojiData.base64 ? Buffer.from(emojiData.base64, "base64") : null);
          if (imgSource) {
            await safeApiCall(() =>
              targetGuild!.emojis.create(imgSource as any, emojiData.name), 2, 600
            );
            emojisCreated++;
            broadcastLog(`  [Emoji ${emojisCreated}/${emojiLimit}] Uploaded: :${emojiData.name}:`, "info");
          }
        } catch (err: any) {
          errorsCount++;
          broadcastLog(`  Notice: Emoji :${emojiData.name}: skipped: ${err.message}`, "warning");
        }
      }
      broadcastLog(`✅ Uploaded ${emojisCreated} emojis.`, "success");
    }

    // 7. Template Link Generation
    let templateUrl: string | null = null;
    if (cfg.targetMode === "template") {
      broadcastProgress(95, "Generating template link...", "Creating discord.new link");
      broadcastLog(`🔗 Generating official Discord server template...`, "info");
      try {
        const template = await safeApiCall(() =>
          targetGuild!.createTemplate(
            targetGuild!.name,
            `Template cloned from ${cfg.sourceGuild.name}`
          ), 3, 1000
        );
        templateUrl = template.url;
        broadcastLog(`🎉 Server Template Link created: ${templateUrl}`, "success");
      } catch (err: any) {
        errorsCount++;
        broadcastLog(`Failed to create template link: ${err.message}`, "error");
      }
    }

    const durationSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
    broadcastProgress(100, "Cloning completed!", `Finished in ${durationSeconds}s`);
    broadcastLog(`🏁 Clone pipeline finished in ${durationSeconds}s (${rolesCreated} roles, ${channelsCreated} channels, ${emojisCreated} emojis, ${errorsCount} issues).`, "success");

    broadcast("complete", {
      success: true,
      duration: `${durationSeconds}s`,
      errorsCount,
      targetGuildId: targetGuild.id,
      targetGuildName: targetGuild.name,
      templateUrl,
      rolesCount: rolesCreated,
      channelsCount: channelsCreated,
      emojisCount: emojisCreated,
    });
  } catch (error: any) {
    const isCancel = error.message === "Cloning cancelled by user.";
    broadcastLog(isCancel ? `🛑 Cloning was cancelled by user.` : `❌ Cloning failed: ${error.message || error}`, isCancel ? "warning" : "error");
    broadcast("complete", {
      success: false,
      cancelled: isCancel,
      error: error.message || "An unknown error occurred during cloning",
    });
  } finally {
    isCloning = false;
    cancelRequested = false;
  }
}

// Start server on free port
const DEFAULT_PORT = 4567;

function startServer(port: number) {
  const server = app.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`\n=================================================`);
    console.log(`  🚀 Discord Server Cloner Web Dashboard is LIVE!`);
    console.log(`  🌐 Open in browser: ${url}`);
    console.log(`=================================================\n`);

    try {
      const openCmd = process.platform === "win32" ? `start ${url}` : process.platform === "darwin" ? `open ${url}` : `xdg-open ${url}`;
      exec(openCmd);
    } catch {}
  });

  server.on("error", (err: any) => {
    if (err.code === "EADDRINUSE") {
      console.log(`Port ${port} in use, trying ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error("Server error:", err);
    }
  });
}

startServer(DEFAULT_PORT);
