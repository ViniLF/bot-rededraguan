// index.js - Bot de Tickets para Discord
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Configurações
const config = {
    token: 'SEU_TOKEN_AQUI',
    guildId: 'ID_DO_SEU_SERVIDOR',
    staffRoleId: 'ID_DO_CARGO_STAFF',
    ticketCategoryId: 'ID_DA_CATEGORIA_TICKETS', // Categoria onde os tickets serão criados
    logChannelId: 'ID_DO_CANAL_LOGS',
    ticketChannelId: 'ID_DO_CANAL_CRIAR_TICKET' // Canal onde o botão de criar ticket ficará
};

// Cliente do Discord
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// Banco de dados simples (em produção, use MongoDB ou SQLite)
const ticketsDB = new Map();

// Função para salvar logs
function saveTranscript(channelId, messages) {
    const dir = './transcripts';
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }
    
    const transcript = messages.map(m => 
        `[${new Date(m.createdTimestamp).toLocaleString()}] ${m.author.tag}: ${m.content}`
    ).join('\n');
    
    fs.writeFileSync(path.join(dir, `${channelId}.txt`), transcript);
    return path.join(dir, `${channelId}.txt`);
}

// Evento quando o bot fica online
client.once('ready', async () => {
    console.log(`✅ Bot online como ${client.user.tag}`);
    
    // Enviar mensagem com botão para criar ticket
    const guild = client.guilds.cache.get(config.guildId);
    const ticketChannel = guild.channels.cache.get(config.ticketChannelId);
    
    // Criar embed
    const embed = new EmbedBuilder()
        .setTitle('🎫 Sistema de Tickets')
        .setDescription('Clique no botão abaixo para criar um ticket de suporte.')
        .setColor('#0099ff')
        .setFooter({ text: 'Sistema de Tickets' });
    
    // Criar botão
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('create_ticket')
                .setLabel('Criar Ticket')
                .setEmoji('📩')
                .setStyle(ButtonStyle.Primary)
        );
    
    // Verificar se já existe uma mensagem do bot
    const messages = await ticketChannel.messages.fetch({ limit: 10 });
    const botMessage = messages.find(m => m.author.id === client.user.id);
    
    if (botMessage) {
        await botMessage.edit({ embeds: [embed], components: [row] });
    } else {
        await ticketChannel.send({ embeds: [embed], components: [row] });
    }
});

// Evento de interação (botões)
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    
    const guild = interaction.guild;
    const member = interaction.member;
    
    // Criar ticket
    if (interaction.customId === 'create_ticket') {
        // Verificar se usuário já tem ticket aberto
        const existingTicket = guild.channels.cache.find(c => 
            c.name === `ticket-${member.user.username.toLowerCase()}` && 
            c.parentId === config.ticketCategoryId
        );
        
        if (existingTicket) {
            return interaction.reply({ 
                content: `Você já tem um ticket aberto: ${existingTicket}`, 
                ephemeral: true 
            });
        }
        
        // Criar canal do ticket
        const ticketChannel = await guild.channels.create({
            name: `ticket-${member.user.username}`,
            type: ChannelType.GuildText,
            parent: config.ticketCategoryId,
            permissionOverwrites: [
                {
                    id: guild.id,
                    deny: [PermissionFlagsBits.ViewChannel],
                },
                {
                    id: member.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                },
                {
                    id: config.staffRoleId,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                },
            ],
        });
        
        // Salvar ticket no "banco de dados"
        ticketsDB.set(ticketChannel.id, {
            userId: member.id,
            channelId: ticketChannel.id,
            createdAt: new Date(),
            status: 'open'
        });
        
        // Embed de boas-vindas
        const welcomeEmbed = new EmbedBuilder()
            .setTitle('🎫 Novo Ticket')
            .setDescription(`Olá ${member}, seu ticket foi criado!\n\nDescreva seu problema e nossa equipe responderá em breve.`)
            .setColor('#00ff00')
            .addFields(
                { name: 'Usuário', value: `${member}`, inline: true },
                { name: 'Status', value: '🟢 Aberto', inline: true }
            )
            .setTimestamp();
        
        // Botões de controle
        const controlRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('Fechar Ticket')
                    .setEmoji('🔒')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('claim_ticket')
                    .setLabel('Assumir Ticket')
                    .setEmoji('🙋')
                    .setStyle(ButtonStyle.Secondary)
            );
        
        await ticketChannel.send({ 
            content: `${member} | <@&${config.staffRoleId}>`,
            embeds: [welcomeEmbed], 
            components: [controlRow] 
        });
        
        await interaction.reply({ 
            content: `Seu ticket foi criado: ${ticketChannel}`, 
            ephemeral: true 
        });
        
        // Log
        const logChannel = guild.channels.cache.get(config.logChannelId);
        if (logChannel) {
            const logEmbed = new EmbedBuilder()
                .setTitle('📩 Ticket Criado')
                .setColor('#0099ff')
                .addFields(
                    { name: 'Usuário', value: `${member.user.tag}`, inline: true },
                    { name: 'Canal', value: `${ticketChannel}`, inline: true }
                )
                .setTimestamp();
            
            await logChannel.send({ embeds: [logEmbed] });
        }
    }
    
    // Fechar ticket
    if (interaction.customId === 'close_ticket') {
        const ticketData = ticketsDB.get(interaction.channel.id);
        
        if (!ticketData) {
            return interaction.reply({ 
                content: 'Este canal não é um ticket válido!', 
                ephemeral: true 
            });
        }
        
        // Confirmar fechamento
        const confirmEmbed = new EmbedBuilder()
            .setTitle('⚠️ Confirmar Fechamento')
            .setDescription('Tem certeza que deseja fechar este ticket?')
            .setColor('#ff0000');
        
        const confirmRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('confirm_close')
                    .setLabel('Confirmar')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('cancel_close')
                    .setLabel('Cancelar')
                    .setStyle(ButtonStyle.Secondary)
            );
        
        await interaction.reply({ 
            embeds: [confirmEmbed], 
            components: [confirmRow],
            ephemeral: true 
        });
    }
    
    // Confirmar fechamento
    if (interaction.customId === 'confirm_close') {
        await interaction.update({ content: 'Fechando ticket...', embeds: [], components: [] });
        
        const channel = interaction.channel;
        const messages = await channel.messages.fetch({ limit: 100 });
        
        // Salvar transcrição
        const transcriptPath = saveTranscript(channel.id, Array.from(messages.values()).reverse());
        
        // Log
        const logChannel = guild.channels.cache.get(config.logChannelId);
        if (logChannel) {
            const ticketData = ticketsDB.get(channel.id);
            const user = await client.users.fetch(ticketData.userId);
            
            const logEmbed = new EmbedBuilder()
                .setTitle('🔒 Ticket Fechado')
                .setColor('#ff0000')
                .addFields(
                    { name: 'Usuário', value: `${user.tag}`, inline: true },
                    { name: 'Fechado por', value: `${interaction.user.tag}`, inline: true },
                    { name: 'Canal', value: `${channel.name}`, inline: true }
                )
                .setTimestamp();
            
            await logChannel.send({ 
                embeds: [logEmbed],
                files: [transcriptPath]
            });
        }
        
        // Deletar do "banco de dados"
        ticketsDB.delete(channel.id);
        
        // Deletar canal após 5 segundos
        setTimeout(() => {
            channel.delete().catch(console.error);
        }, 5000);
    }
    
    // Cancelar fechamento
    if (interaction.customId === 'cancel_close') {
        await interaction.update({ 
            content: 'Fechamento cancelado!', 
            embeds: [], 
            components: [] 
        });
    }
    
    // Assumir ticket
    if (interaction.customId === 'claim_ticket') {
        if (!member.roles.cache.has(config.staffRoleId)) {
            return interaction.reply({ 
                content: 'Apenas membros da staff podem assumir tickets!', 
                ephemeral: true 
            });
        }
        
        const claimEmbed = new EmbedBuilder()
            .setDescription(`🙋 Ticket assumido por ${interaction.user}`)
            .setColor('#00ff00');
        
        await interaction.reply({ embeds: [claimEmbed] });
    }
});

// Login do bot
if (!config.token) {
    console.error('❌ ERRO: Token não encontrado!');
    console.error('Certifique-se de configurar a variável de ambiente BOT_TOKEN');
    console.error('Use o comando: .env add BOT_TOKEN=seu_token_aqui');
    process.exit(1);
}

console.log('🚀 Tentando fazer login...');
client.login(config.token).catch(error => {
    console.error('❌ Erro ao fazer login:', error.message);
    if (error.code === 'TokenInvalid') {
        console.error('O token fornecido é inválido. Verifique se:');
        console.error('1. Copiou o token completo');
        console.error('2. Não incluiu espaços extras');
        console.error('3. O token não expirou (gere um novo se necessário)');
    }
});