const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Partials, Collection } = require('discord.js');
const fs = require('fs');
const dotenv = require('dotenv');
const i18next = require('i18next');

dotenv.config();

const isTestMode = process.argv.includes('--test');

const resources = {};
if (fs.existsSync('./locales')) {
    const localeFiles = fs.readdirSync('./locales').filter(f => f.endsWith('.json'));
    localeFiles.forEach(f => {
        const lang = f.replace('.json', '');
        resources[lang] = { translation: JSON.parse(fs.readFileSync(`./locales/${f}`, 'utf8')) };
    });
}

i18next.init({
    lng: 'ja',
    fallbackLng: 'ja',
    resources: resources
});

const getInteractionLang = (interaction) => {
    const locale = interaction.locale || 'ja';
    if (locale.startsWith('ja')) return 'ja';
    if (locale.startsWith('zh')) return 'zh';
    return 'en';
};
const getGuildLang = (interaction) => {
    const locale = interaction.guildLocale || 'ja';
    if (locale.startsWith('ja')) return 'ja';
    if (locale.startsWith('zh')) return 'zh';
    return 'en';
};

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildPresences,
    ]
});

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;
const requiredRoleId = process.env.REQUIRED_ROLE_ID;

const DATA_DIR = './data';
const STATE_FILE = './data/state.json';
const LOG_DIR = './log';

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR);
if (!fs.existsSync(STATE_FILE)) fs.writeFileSync(STATE_FILE, JSON.stringify({ activeTrials: {}, cooldowns: {}, originalNicks: {}, lastSeen: {}, settings: {} }, null, 4));

const stateManager = {
    data: { activeTrials: {}, cooldowns: {}, originalNicks: {}, lastSeen: {}, settings: {} },
    load() {
        if (fs.existsSync(STATE_FILE)) {
            const raw = fs.readFileSync(STATE_FILE, 'utf8');
            if (raw.trim() !== '') this.data = JSON.parse(raw);
        }
        if (!this.data.activeTrials) this.data.activeTrials = {};
        if (!this.data.cooldowns) this.data.cooldowns = {};
        if (!this.data.originalNicks) this.data.originalNicks = {};
        if (!this.data.lastSeen) this.data.lastSeen = {};
        if (!this.data.settings) this.data.settings = {};
    },
    save() {
        fs.writeFileSync(STATE_FILE, JSON.stringify(this.data, null, 4));
    },
    getTrial(channelId) { return this.data.activeTrials[channelId]; },
    setTrial(channelId, trialData) {
        this.data.activeTrials[channelId] = trialData;
        this.save();
    },
    deleteTrial(channelId) {
        delete this.data.activeTrials[channelId];
        this.save();
    },
    checkCooldown(userId) {
        if (isTestMode || process.env.DISABLE_COOLDOWN === 'true') return true;
        const lastUsed = this.data.cooldowns[userId];
        if (!lastUsed) return true;
        const sevenDays = 7 * 24 * 60 * 60 * 1000;
        return (Date.now() - lastUsed) > sevenDays;
    },
    setCooldown(userId) {
        this.data.cooldowns[userId] = Date.now();
        this.save();
    },
    saveNick(userId, nick) {
        this.data.originalNicks[userId] = nick;
        this.save();
    },
    getNick(userId) {
        return this.data.originalNicks[userId];
    },
    updateLastSeen(guildId, userId) {
        if (!this.data.lastSeen[guildId]) this.data.lastSeen[guildId] = {};
        this.data.lastSeen[guildId][userId] = Date.now();
        this.save();
    },
    getLastSeen(guildId, userId) {
        if (!this.data.lastSeen[guildId]) return 0;
        return this.data.lastSeen[guildId][userId] || 0;
    },
    getSettings(guildId) {
        if (!this.data.settings[guildId]) {
            this.data.settings[guildId] = { punishmentMode: 'timeout', minTO: 1, maxTO: 5 };
        }
        return this.data.settings[guildId];
    },
    updateSettings(guildId, newSettings) {
        this.data.settings[guildId] = { ...this.getSettings(guildId), ...newSettings };
        this.save();
    },
    resetSettings(guildId) {
        this.data.settings[guildId] = { punishmentMode: 'timeout', minTO: 1, maxTO: 5 };
        this.save();
    },
    clearNick(userId) {
        delete this.data.originalNicks[userId];
        this.save();
    }
};
stateManager.load();

const getSlashCommands = (guildId) => {
    const settings = stateManager.getSettings(guildId);
    const cmdGu = new SlashCommandBuilder()
        .setName('gu')
        .setDescription('【裁判官専用】被告に判決（有罪）を下します。');
    
    if (settings.punishmentMode === 'timeout') {
        cmdGu.addNumberOption(option => option.setName('timeout').setDescription('タイムアウト時間（分）を指定します。 (1-5)').setRequired(true));
    } else if (settings.punishmentMode === 'batsu') {
        cmdGu.addStringOption(option => option.setName('batsu').setDescription('罰ゲームの内容を入力します。').setRequired(true));
    }

    return [
        cmdJudgmentBase('judgement', '領域展開「誅伏賜死」を開始します。'),
        cmdJudgmentBase('誅伏賜死', '領域展開「誅伏賜死」を開始します(judgementと同一)'),
        cmdJudgmentBase('開廷', '領域展開「誅伏賜死」を開始します(judgementと同一)'),
        cmdJudgmentBase('deadly-sentencing', '領域展開「誅伏賜死」を開始します(judgementと同一)'),
        cmdGu,
        new SlashCommandBuilder()
            .setName('settingjudge')
            .setDescription('サーバーの判決ルール（TO、罰ゲームの有効/無効）を変更します。')
            .addStringOption(opt => opt.setName('mode')
                .setDescription('処罰モードを選択してください。')
                .setRequired(true)
                .addChoices(
                    { name: 'タイムアウト (Timeout)', value: 'timeout' },
                    { name: '罰ゲーム (Batsu)', value: 'batsu' },
                    { name: '罰なし (None)', value: 'none' }
                )
            ),
        new SlashCommandBuilder().setName('resetsetting').setDescription('サーバーの設定を初期値にリセットします。'),
        new SlashCommandBuilder().setName('in').setDescription('【裁判官専用】無罪を宣告し、被告に罪を課しません。'),
        new SlashCommandBuilder().setName('re').setDescription('【弁護人/被告限定】猶予期間内に使用。ペナルティを代償に再審を行います。'),
        new SlashCommandBuilder().setName('info').setDescription('現在進行中の裁判についての情報を表示します。'),
        new SlashCommandBuilder().setName('forceclose').setDescription('【開発者専用】強制的に現在の裁判を終了しクリーンアップします。'),
        new SlashCommandBuilder().setName('action').setDescription('法廷内での行動を宣言します。')
            .addStringOption(opt => opt.setName('type').setDescription('行動内容').setRequired(true)),
        new SlashCommandBuilder().setName('dm').setDescription('【当事者限定】法廷内の特定の相手に通信を送信します。')
            .addUserOption(opt => opt.setName('target').setDescription('送信相手となる当事者').setRequired(true))
            .addStringOption(opt => opt.setName('message').setDescription('メッセージ内容').setRequired(true)),
    ];
};

async function deployCommands(guildIdToDeploy = null) {
    const rest = new REST({ version: '10' }).setToken(token);
    try {
        const targetId = guildIdToDeploy || guildId;
        if (targetId) {
            const cmds = getSlashCommands(targetId);
            await rest.put(Routes.applicationGuildCommands(clientId, targetId), { body: cmds });
            console.log(`[SYS] Registered commands for ${targetId}`);
        } else {
            // Global (Fallback/Normal)
            const cmds = getSlashCommands(null);
            await rest.put(Routes.applicationCommands(clientId), { body: cmds });
            console.log('[SYS] Registered global commands');
        }
    } catch (error) {
        console.error(error);
    }
}

client.once('clientReady', async () => {
    console.log(`[SYS] Judgeman logged in (${client.user.tag})`);
    if (isTestMode) console.log(`[SYS] Test mode is active`);
    await deployCommands();
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.guild) {
        stateManager.updateLastSeen(message.guild.id, message.author.id);
    }

    let trialForThisChannel = stateManager.getTrial(message.channel.id);
    if (trialForThisChannel && trialForThisChannel.phase > 0) {
        trialForThisChannel.chatLogs = trialForThisChannel.chatLogs || [];
        trialForThisChannel.chatLogs.push(`[${new Date().toLocaleTimeString('ja-JP')}] ${message.author.username}: ${message.content}`);
        stateManager.setTrial(message.channel.id, trialForThisChannel);
    }

    const trials = Object.values(stateManager.data.activeTrials);
    for (const t of trials) {
        if (t.phase > 0 && [t.judge, t.prosecutor, t.defendant, t.defencer].includes(message.author.id)) {
            if (message.channel.id !== t.channelId) {
                try {
                    await message.delete();
                    await message.author.send(i18next.t('mute_warning', { lng: t.lang })).catch(()=>{});
                } catch(e){}
                return;
            }
        }
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand() && !interaction.isButton()) return;
    
    const lng = getInteractionLang(interaction);

    if (interaction.isChatInputCommand()) {
        const cmd = interaction.commandName;
        
        if (['judgement', '誅伏賜死', '開廷', 'deadly-sentencing'].includes(cmd)) {
            await handleJudgementStart(interaction, lng);
        } else if (cmd === 'forceclose') {
            if (interaction.user.id !== '1427546345379467285') {
                return interaction.reply({ content: i18next.t('error.dev_only', { lng }), ephemeral: true });
            }
            const trial = stateManager.getTrial(interaction.channelId);
            if (!trial) return interaction.reply({ content: i18next.t('error.no_trial', { lng }), ephemeral: true });
            await interaction.reply({ content: i18next.t('trial.dev_force', { lng }) });
            await finalizePunishment(interaction.channelId, interaction.guild, trial, 'force');

        } else if (cmd === 'action') {
            const trial = stateManager.getTrial(interaction.channelId);
            if (!trial || trial.phase < 1) return interaction.reply({ content: i18next.t('error.no_trial', { lng }), ephemeral: true });
            const type = interaction.options.getString('type');
            const actionEmbed = new EmbedBuilder()
                .setDescription(i18next.t('trial.action_desc', { lng: trial.lang, user: interaction.user.id, action: type }))
                .setColor(0x2c2f33);
            await interaction.reply({ embeds: [actionEmbed] });
            
            trial.chatLogs = trial.chatLogs || [];
            trial.chatLogs.push(`[${new Date().toLocaleTimeString('ja-JP')}] ${interaction.user.username} (Action): ${type}`);
            stateManager.setTrial(interaction.channelId, trial);

        } else if (cmd === 'dm') {
            const trial = stateManager.getTrial(interaction.channelId);
            if (!trial || trial.phase < 1) return interaction.reply({ content: i18next.t('error.no_trial', { lng }), ephemeral: true });
            const isActor = [trial.judge, trial.prosecutor, trial.defendant, trial.defencer].includes(interaction.user.id);
            if (!isActor) return interaction.reply({ content: i18next.t('error.cant_dm', { lng }), ephemeral: true });
            
            const target = interaction.options.getUser('target');
            const msgObj = interaction.options.getString('message');
            const targetIsActor = [trial.judge, trial.prosecutor, trial.defendant, trial.defencer].includes(target.id);
            if (!targetIsActor) return interaction.reply({ content: i18next.t('error.cant_dm_target', { lng }), ephemeral: true });

            const dmId = Date.now().toString();
            trial.pendingDMs = trial.pendingDMs || {};
            trial.pendingDMs[dmId] = { from: interaction.user.id, to: target.id, message: msgObj };
            stateManager.setTrial(interaction.channelId, trial);

            const btnRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`dm_read_${trial.id}_${dmId}`).setLabel(i18next.t('trial.dm_btn', { lng: trial.lang, target: target.username })).setStyle(ButtonStyle.Secondary)
            );
            await interaction.reply({ content: i18next.t('trial.dm_sent', { lng: trial.lang, target: target.id }), components: [btnRow] });

        } else if (cmd === 'gu' || cmd === 'in') {
            const trial = stateManager.getTrial(interaction.channelId);
            if (!trial || trial.judge !== interaction.user.id) {
                return interaction.reply({ content: i18next.t('error.not_judge', { lng }), ephemeral: true });
            }
            if (!trial.punishmentAllowed || trial.phase !== 1) {
                return interaction.reply({ content: i18next.t('error.not_waiting', { lng }), ephemeral: true });
            }
            if (trial.pendingPunishment) {
                return interaction.reply({ content: i18next.t('error.already_pending', { lng }), ephemeral: true });
            }

            if (cmd === 'gu') {
                const settings = stateManager.getSettings(interaction.guildId);
                const timeoutMinutes = interaction.options.getNumber('timeout') ?? 0;
                const batsu = interaction.options.getString('batsu');

                if (settings.punishmentMode === 'timeout' && timeoutMinutes > 0) {
                    if (timeoutMinutes < settings.minTO || timeoutMinutes > settings.maxTO) {
                        return interaction.reply({ content: `判決エラー：タイムアウトは ${settings.minTO}分 から ${settings.maxTO}分 の範囲で指定してください。`, ephemeral: true });
                    }
                }

                trial.pendingPunishment = 'to';
                trial.baseMinutes = timeoutMinutes;
                trial.pendingBatsu = (settings.punishmentMode === 'batsu') ? batsu : null;
                trial.reAllowed = true;
                stateManager.setTrial(interaction.channelId, trial);

                let sentenceMsg = '';
                if (settings.punishmentMode === 'timeout') {
                    sentenceMsg = i18next.t('trial.sentence_timeout', { lng: trial.lang, defendant: trial.defendant, minutes: timeoutMinutes });
                } else if (settings.punishmentMode === 'batsu') {
                    sentenceMsg = i18next.t('trial.batsu_applied', { lng: trial.lang, defendant: trial.defendant, batsu: batsu });
                } else {
                    sentenceMsg = i18next.t('trial.batsu_none_applied', { lng: trial.lang, defendant: trial.defendant });
                }

                await interaction.reply(sentenceMsg);

                setTimeout(async () => {
                    const checkTrial = stateManager.getTrial(interaction.channelId);
                    if (checkTrial && checkTrial.id === trial.id && checkTrial.pendingPunishment === 'to' && checkTrial.phase === 1) {
                        try {
                            await finalizePunishment(interaction.channelId, interaction.guild, checkTrial, 'to');
                        } catch(e){}
                    }
                }, isTestMode ? 15 * 1000 : 30 * 1000);
            } else {
                await interaction.reply(i18next.t('trial.sentence_innocent', { lng: trial.lang, defendant: trial.defendant }));
                await finalizePunishment(interaction.channelId, interaction.guild, trial, 'in');
            }

        } else if (cmd === 're') {
            const trial = stateManager.getTrial(interaction.channelId);
            if (!trial || (interaction.user.id !== trial.defencer && interaction.user.id !== trial.defendant)) {
                return interaction.reply({ content: i18next.t('error.not_defencer', { lng }), ephemeral: true });
            }
            if (!trial.reAllowed) {
                return interaction.reply({ content: i18next.t('error.no_re', { lng }), ephemeral: true });
            }

            trial.phase += 1;
            trial.penaltyMultiplier = (trial.phase === 2) ? 2 : 4;
            trial.punishmentAllowed = false;
            trial.reAllowed = false;
            stateManager.setTrial(interaction.channelId, trial);

            await interaction.reply(i18next.t('trial.re_accepted', { lng: trial.lang, phase: trial.phase }));
            startTrialPhase(interaction.channelId);

            const settings = stateManager.getSettings(interaction.guildId);
            const statusStr = `[Mode: ${settings.punishmentMode}]`;
            
            await interaction.reply(i18next.t('trial.status', { lng, phase: trial.phase, defendant: trial.defendant, defencer: trial.defencer, prosecutor: trial.prosecutor, judge: trial.judge, charge: trial.charge, multiplier: trial.penaltyMultiplier, statusStr }));
        } else if (cmd === 'settingjudge') {
            const mode = interaction.options.getString('mode');
            stateManager.updateSettings(interaction.guildId, { punishmentMode: mode });
            await interaction.reply({ content: `設定を更新しました。モード: ${mode}`, ephemeral: true });
            await deployCommands(interaction.guildId);
        } else if (cmd === 'resetsetting') {
            stateManager.resetSettings(interaction.guildId);
            await interaction.reply({ content: `サーバー設定を初期値にリセットしました。`, ephemeral: true });
            await deployCommands(interaction.guildId);
        }
    }
    
    if (interaction.isButton()) {
        const parts = interaction.customId.split('_');
        const type = parts[0];
        const action = parts[1];
        const trialId = parts[2];
        
        const trial = stateManager.getTrial(interaction.channelId);
        if (!trial || trial.id !== trialId) return;

        if (type === 'vote') {
            if (trial.phase !== 0) return interaction.reply({content: i18next.t('error.vote_ended', { lng }), ephemeral: true});
            
            if (action === 'disagree') {
                const isActor = [trial.judge, trial.prosecutor, trial.defencer, trial.defendant].includes(interaction.user.id);
                // 被告人が反対した場合は即時却下せず、3票分としてカウントする（後続の処理で対応）
                // 被告人以外の当事者が反対した場合は、従来どおり即時却下する
                if (isActor && interaction.user.id !== trial.defendant) {
                    await interaction.reply(i18next.t('trial.vote_rejected_by_actor', { lng: trial.lang }));
                    stateManager.deleteTrial(interaction.channelId);
                    return;
                }
            }
            
            if (action === 'agree') {
                if (trial.votesAgree.includes(interaction.user.id)) return interaction.reply({ content: i18next.t('error.already_voted_agree', { lng }), ephemeral: true });
                trial.votesAgree.push(interaction.user.id);
                trial.votesDisagree = trial.votesDisagree.filter(id => id !== interaction.user.id);
            } else if (action === 'disagree') {
                if (trial.votesDisagree.includes(interaction.user.id)) return interaction.reply({ content: i18next.t('error.already_voted_disagree', { lng }), ephemeral: true });
                trial.votesDisagree.push(interaction.user.id);
                trial.votesAgree = trial.votesAgree.filter(id => id !== interaction.user.id);
            }
            stateManager.setTrial(interaction.channelId, trial);
            const actionT = i18next.t(action === 'agree' ? 'trial.btn_agree' : 'trial.btn_disagree', { lng });
            
            const agreeCount = trial.votesAgree.length;
            const disagreeCount = trial.votesDisagree.reduce((acc, id) => acc + (id === trial.defendant ? 3 : 1), 0);
            
            await interaction.reply({ content: i18next.t('trial.vote_recorded', { lng, action: actionT, agree: agreeCount, disagree: disagreeCount }), ephemeral: true });
        
        } else if (type === 'jury') {
            const isActor = [trial.prosecutor, trial.defencer, trial.defendant].includes(interaction.user.id);
            if (isActor && interaction.user.id !== trial.judge) {
                return interaction.reply({content: i18next.t('error.cant_jury', { lng }), ephemeral: true});
            }

            if (action === 'guilty') {
                if (trial.juryGuilty.includes(interaction.user.id)) return interaction.reply({ content: i18next.t('error.already_voted_guilty', { lng }), ephemeral: true });
                trial.juryGuilty.push(interaction.user.id);
                trial.juryInnocent = trial.juryInnocent.filter(id => id !== interaction.user.id);
            } else if (action === 'innocent') {
                if (trial.juryInnocent.includes(interaction.user.id)) return interaction.reply({ content: i18next.t('error.already_voted_innocent', { lng }), ephemeral: true });
                trial.juryInnocent.push(interaction.user.id);
                trial.juryGuilty = trial.juryGuilty.filter(id => id !== interaction.user.id);
            }
            stateManager.setTrial(interaction.channelId, trial);
            const actionT = i18next.t(action === 'guilty' ? 'trial.btn_guilty' : 'trial.btn_innocent', { lng });
            await interaction.reply({ content: i18next.t('trial.jury_recorded', { lng, action: actionT }), ephemeral: true });
        
        } else if (type === 'dm') {
            const dmId = parts[3];
            const dmObj = trial.pendingDMs && trial.pendingDMs[dmId];
            if (!dmObj) return interaction.reply({ content: i18next.t('error.dm_lost', { lng }), ephemeral: true });
            
            if (interaction.user.id !== dmObj.to) {
                return interaction.reply({ content: i18next.t('error.dm_denied', { lng }), ephemeral: true });
            }
            await interaction.reply({ content: i18next.t('trial.dm_content', { lng, from: dmObj.from, msg: dmObj.message }), ephemeral: true });

        } else if (type === 'info') {
            if (action === 'role') {
                let explanation = i18next.t('spectator', { lng });
                if (interaction.user.id === trial.judge) {
                    explanation = i18next.t('roles.judge', { lng });
                } else if (interaction.user.id === trial.prosecutor) {
                    explanation = i18next.t('roles.prosecutor', { lng });
                } else if (interaction.user.id === trial.defencer && interaction.user.id === trial.defendant) {
                    explanation = i18next.t('roles.defendant', { lng }) + "\n\n" + i18next.t('roles.defencer', { lng });
                } else if (interaction.user.id === trial.defendant) {
                    explanation = i18next.t('roles.defendant', { lng });
                } else if (interaction.user.id === trial.defencer) {
                    explanation = i18next.t('roles.defencer', { lng });
                }
                await interaction.reply({ content: explanation, ephemeral: true });
            }
        }
    }
});

async function handleJudgementStart(interaction, lng) {
    if (!stateManager.checkCooldown(interaction.user.id)) {
        return interaction.reply({ content: i18next.t('error.cooldown', { lng }), ephemeral: true });
    }
    
    // Channel Restriction
    const allowedChannelsStr = process.env.ALLOWED_CHANNELS;
    if (allowedChannelsStr && allowedChannelsStr.trim() !== '') {
        const allowedIds = allowedChannelsStr.split(',').map(id => id.trim());
        if (!allowedIds.includes(interaction.channelId)) {
            return interaction.reply({ content: i18next.t('error.restricted_channel', { lng }), ephemeral: true });
        }
    }

    if (requiredRoleId && requiredRoleId.trim() !== '') {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!member.roles.cache.has(requiredRoleId)) {
            return interaction.reply({ content: i18next.t('error.no_permission', { lng }), ephemeral: true });
        }
    }

    const prosecutor = interaction.options.getUser('prosecutor');
    let defendant = interaction.options.getUser('defendant');
    const judge = interaction.options.getUser('judge');
    const charge = interaction.options.getString('charge');
    const defencer = interaction.options.getUser('defencer') || defendant;

    if (!isTestMode) {
        const actorSet = new Set([prosecutor.id, judge.id, defendant.id]);
        if (actorSet.size !== 3 || prosecutor.id === defencer.id || judge.id === defencer.id) {
            return interaction.reply({ content: i18next.t('error.role_overlap', { lng }), ephemeral: true });
        }

        const actors = [prosecutor, defendant, judge, defencer];
        const oneHourAgo = Date.now() - (60 * 60 * 1000);

        for (const actorUser of actors) {
            try {
                const member = await interaction.guild.members.fetch({ user: actorUser.id, withPresences: true }).catch(() => null);
                
                // 1. Online Check (Only allow 'online' status)
                const status = (member && member.presence) ? member.presence.status : 'offline';
                if (status !== 'online') {
                    return interaction.reply({ content: i18next.t('error.user_offline', { lng }), ephemeral: true });
                }

                // 2. Activity Check (within 1 hour)
                const lastSeen = stateManager.getLastSeen(interaction.guild.id, actorUser.id);
                if (lastSeen < oneHourAgo) {
                    return interaction.reply({ content: i18next.t('error.user_inactive', { lng }), ephemeral: true });
                }
            } catch (e) {
                console.error(`Status check error for ${actorUser.tag}:`, e);
            }
        }
    }

    const trialId = Date.now().toString();
    const trialLang = getGuildLang(interaction);

    const trialData = {
        id: trialId,
        lang: trialLang,
        phase: 0,
        prosecutor: prosecutor.id,
        defendant: defendant.id,
        judge: judge.id,
        defencer: defencer.id,
        charge: charge,
        punishmentAllowed: false,
        reAllowed: false,
        pendingPunishment: null,
        baseMinutes: 0,
        penaltyMultiplier: 1,
        channelId: interaction.channelId,
        votesAgree: [],
        votesDisagree: [],
        juryGuilty: [],
        juryInnocent: [],
        chatLogs: [],
        pendingDMs: {}
    };
    stateManager.setTrial(interaction.channelId, trialData);
    stateManager.setCooldown(interaction.user.id);

    const embed = new EmbedBuilder()
        .setTitle(i18next.t('trial.start_embed_title', { lng: trialLang }))
        .setDescription(i18next.t('trial.start_embed_desc', { lng: trialLang, defencer: defencer.id, prosecutor: prosecutor.id, defendant: defendant.id, judge: judge.id, charge: charge }))
        .setColor(0x2c2f33);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`vote_agree_${trialId}`).setLabel(i18next.t('trial.btn_agree', { lng: trialLang })).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`vote_disagree_${trialId}`).setLabel(i18next.t('trial.btn_disagree', { lng: trialLang })).setStyle(ButtonStyle.Danger)
    );

    await interaction.reply({ embeds: [embed], components: [row] });

    setTimeout(async () => {
        const currentTrial = stateManager.getTrial(interaction.channelId);
        if (currentTrial && currentTrial.id === trialId && currentTrial.phase === 0) {
            const agreeCount = currentTrial.votesAgree.length;
            const disagreeCount = currentTrial.votesDisagree.reduce((acc, id) => acc + (id === currentTrial.defendant ? 3 : 1), 0);

            if (agreeCount > disagreeCount) {
                await startFirstPhase(interaction, currentTrial);
            } else {
                await interaction.channel.send(i18next.t('trial.rejected_by_vote', { lng: trialLang }));
                stateManager.deleteTrial(interaction.channelId);
            }
        }
    }, isTestMode ? 10 * 1000 : 60 * 1000);
}

async function startFirstPhase(interaction, trialData) {
    trialData.phase = 1;
    stateManager.setTrial(trialData.channelId, trialData);
    const lng = trialData.lang;

    const msgContent = i18next.t('trial.phase1_start', { lng, defendant: trialData.defendant, defencer: trialData.defencer, prosecutor: trialData.prosecutor, judge: trialData.judge, charge: trialData.charge });
    const btnRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`info_role_${trialData.id}`).setLabel(i18next.t('trial.btn_check_role', { lng })).setStyle(ButtonStyle.Secondary)
    );

    await interaction.channel.send({ content: msgContent, components: [btnRow] });

    const roleColors = {
        '裁判官': 0xF1C40F, // Gold
        '検事': 0xE74C3C,   // Red
        '弁護人': 0x3498DB, // Blue
        '被告': 0x95A5A6    // Gray
    };
    const roleMap = {};
    try {
        const guildRoles = await interaction.guild.roles.fetch();
        const botMember = await interaction.guild.members.fetch(client.user.id);
        const botHighestRole = botMember.roles.highest;
        const targetPos = botHighestRole.position > 0 ? botHighestRole.position - 1 : 0;

        for (const [name, color] of Object.entries(roleColors)) {
            let r = guildRoles.find(r => r.name === name);
            if (!r) {
                r = await interaction.guild.roles.create({ 
                    name: name, 
                    color: color, 
                    position: targetPos,
                    reason: 'Judgeman Trial Roles' 
                });
            } else {
                await r.setColor(color).catch(()=>{});
                // ボットのロールより下になるように位置を調整
                if (r.position >= botHighestRole.position) {
                    await r.setPosition(targetPos).catch(()=>{});
                }
            }
            roleMap[name] = r;
        }

        const assignRoleAndNick = async (userId, rolesToAdd, nickSuffix) => {
            try {
                const member = await interaction.guild.members.fetch(userId);
                const actualRoles = rolesToAdd.map(n => roleMap[n]);
                await member.roles.add(actualRoles);

                // まだニックネームが保存されていない場合のみ保存（二重保存防止）
                if (stateManager.getNick(userId) === undefined) {
                    stateManager.saveNick(userId, member.nickname === null ? '' : member.nickname);
                }
                
                const currentName = member.displayName;
                await member.setNickname(`【${nickSuffix}】${currentName}`).catch(()=>{});
            } catch (e) {
                console.log(`Role assigned error (${userId}):`, e.message);
            }
        };

        await assignRoleAndNick(trialData.judge, ['裁判官'], '裁判官');
        await assignRoleAndNick(trialData.prosecutor, ['検事'], '検事');

        if (trialData.defendant === trialData.defencer) {
            await assignRoleAndNick(trialData.defendant, ['被告', '弁護人'], '被告兼弁護人');
        } else {
            await assignRoleAndNick(trialData.defendant, ['被告'], '被告');
            await assignRoleAndNick(trialData.defencer, ['弁護人'], '弁護人');
        }
    } catch(e) { }

    startTrialPhase(trialData.channelId);
}

function startTrialPhase(channelId) {
    const trial = stateManager.getTrial(channelId);
    if (!trial) return;

    let waitTime;
    if (trial.phase === 3) {
        waitTime = isTestMode ? 5 * 1000 : 3 * 60 * 1000;
    } else {
        waitTime = isTestMode ? 10 * 1000 : 5 * 60 * 1000;
    }

    setTimeout(async () => {
        const currentTrial = stateManager.getTrial(channelId);
        if (!currentTrial || currentTrial.phase !== trial.phase) return;

        const channel = client.channels.cache.get(channelId);
        if (!channel) return;
        const lng = currentTrial.lang;

        if (currentTrial.phase === 1) {
            currentTrial.punishmentAllowed = true;
            stateManager.setTrial(channelId, currentTrial);

            await channel.send(i18next.t('trial.phase1_judge_allow', { lng }));

        } else if (currentTrial.phase === 2 || currentTrial.phase === 3) {
            currentTrial.reAllowed = (currentTrial.phase === 2);
            stateManager.setTrial(channelId, currentTrial);

            const msgText = currentTrial.phase === 3 ? i18next.t('trial.phase3_start', { lng }) : i18next.t('trial.phase2_start', { lng });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`jury_guilty_${currentTrial.id}`).setLabel(i18next.t('trial.btn_guilty', { lng })).setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`jury_innocent_${currentTrial.id}`).setLabel(i18next.t('trial.btn_innocent', { lng })).setStyle(ButtonStyle.Primary)
            );

            await channel.send({ content: msgText, components: [row] });

            setTimeout(async () => {
                const refreshedTrial = stateManager.getTrial(channelId);
                if (!refreshedTrial || refreshedTrial.phase !== currentTrial.phase) return;
                
                if (refreshedTrial.juryGuilty.length > refreshedTrial.juryInnocent.length) {
                    await channel.send(i18next.t('trial.jury_result_guilty', { lng, guilty: refreshedTrial.juryGuilty.length, innocent: refreshedTrial.juryInnocent.length }));
                    await finalizePunishment(channelId, channel.guild, refreshedTrial, 'to');
                } else {
                    await channel.send(i18next.t('trial.jury_result_innocent', { lng, guilty: refreshedTrial.juryGuilty.length, innocent: refreshedTrial.juryInnocent.length }));
                    await finalizePunishment(channelId, channel.guild, refreshedTrial, 'in');
                }
            }, isTestMode ? 15 * 1000 : 30 * 1000); 
        }
    }, waitTime);
}

async function finalizePunishment(channelId, guild, trial, resultType) {
    const channel = client.channels.cache.get(channelId);
    const lng = trial.lang;
    let finalStr = '無罪 (Innocent)';

    if (resultType === 'to') {
        const finalMinutes = trial.baseMinutes * trial.penaltyMultiplier;
        const settings = stateManager.getSettings(guild.id);
        
        if (settings.punishmentMode === 'timeout') {
            finalStr = `タイムアウト (Timeout) ${finalMinutes}分 (mins)`;
        } else if (settings.punishmentMode === 'batsu') {
            finalStr = `有罪（罰ゲーム実行） [内容: ${trial.pendingBatsu}]`;
        } else {
            finalStr = `有罪（刑罰なし）`;
        }

        try {
            const targetMember = await guild.members.fetch(trial.defendant);
            if (settings.punishmentMode === 'timeout' && finalMinutes > 0) {
                await targetMember.timeout(finalMinutes * 60 * 1000, `Judicial verdict: ${trial.charge}`);
                let msg = i18next.t('trial.timeout_applied', { lng, defendant: trial.defendant, minutes: finalMinutes });
                if (channel) await channel.send(msg);
            } else if (settings.punishmentMode === 'batsu') {
                let msg = i18next.t('trial.batsu_applied', { lng, defendant: trial.defendant, batsu: trial.pendingBatsu });
                if (channel) await channel.send(msg);
            } else {
                let msg = i18next.t('trial.batsu_none_applied', { lng, defendant: trial.defendant });
                if (channel) await channel.send(msg);
            }
        } catch (e) {
            console.error(e);
            if (channel) {
                await channel.send(i18next.t('error.timeout_fail', { lng, msg: e.message }));
            }
        }
    } else if (resultType === 'force') {
        finalStr = '強制終了 (Forced Termination)';
    }

    const roleNames = ['裁判官', '検事', '弁護人', '被告'];
    try {
        const guildRoles = await guild.roles.fetch();
        const removeRoles = roleNames.map(name => guildRoles.find(r => r.name === name)).filter(r => r);

        const restoreUser = async (userId) => {
            try {
                const member = await guild.members.fetch(userId);
                await member.roles.remove(removeRoles);
                const originalNick = stateManager.getNick(userId);
                if (originalNick !== undefined) { 
                    await member.setNickname(originalNick === '' ? null : originalNick).catch(()=>{});
                    stateManager.clearNick(userId); // 復元後にクリア
                }
            } catch(e){}
        };

        const uniqueUsers = new Set([trial.judge, trial.prosecutor, trial.defendant, trial.defencer]);
        for (const uid of uniqueUsers) await restoreUser(uid);
    } catch(e) {}

    const userMap = {};
    const allRelevantIds = new Set([
        trial.judge, trial.prosecutor, trial.defendant, trial.defencer,
        ...(trial.votesAgree || []), ...(trial.votesDisagree || []),
        ...(trial.juryGuilty || []), ...(trial.juryInnocent || [])
    ]);
    for (const uid of allRelevantIds) {
        if (!uid) continue;
        try {
            const user = await client.users.fetch(uid).catch(() => null);
            userMap[uid] = user ? user.tag : `Unknown (${uid})`;
        } catch(e) {
            userMap[uid] = `ErrorResolving (${uid})`;
        }
    }

    const formatVoters = (ids) => ids && ids.length > 0 ? ids.map(id => userMap[id] || id).join(', ') : '(None)';
    const allLogs = trial.chatLogs && trial.chatLogs.length > 0 ? trial.chatLogs.join('\n') : '(法廷内での発言なし / No court chat logs)';
    
    let mappingText = '';
    for (const [id, tag] of Object.entries(userMap)) {
        mappingText += `${tag} : ${id}\n`;
    }

    const agreeCountLog = trial.votesAgree.length;
    const disagreeCountLog = trial.votesDisagree.reduce((acc, id) => acc + (id === trial.defendant ? 3 : 1), 0);

    const logText = `
=== 裁判ログ / Trial Log (ID: ${trial.id}) ===
終了日時: ${new Date().toLocaleString('ja-JP')}
罪状: ${trial.charge}
裁判官: ${userMap[trial.judge]}
検事: ${userMap[trial.prosecutor]}
弁護人: ${userMap[trial.defencer]}
被告: ${userMap[trial.defendant]}
最終フェーズ: 第${trial.phase}審
最終判決: ${finalStr}

[詳細な投票記録 / Detailed Voting Records]
妥当性同意 (Validity Agree): ${agreeCountLog}票 (${formatVoters(trial.votesAgree)})
妥当性反対 (Validity Disagree): ${disagreeCountLog}票 (${formatVoters(trial.votesDisagree)})
陪審員有罪 (Jury Guilty): ${trial.juryGuilty.length}票 (${formatVoters(trial.juryGuilty)})
陪審員無罪 (Jury Innocent): ${trial.juryInnocent.length}票 (${formatVoters(trial.juryInnocent)})

=== 法廷での全発言記録 / Full Court Transcript ===
${allLogs}

=== ユーザーID対応表 / User ID Mapping ===
${mappingText.trim()}
`;
    fs.writeFileSync(`${LOG_DIR}/trial_${trial.id}.txt`, logText.trim());

    stateManager.deleteTrial(channelId);
    if (channel) await channel.send(i18next.t('trial.close', { lng }));
}

if (!token) {
    console.error('DISCORD_TOKEN is missing');
    process.exit(1);
}
client.login(token);
