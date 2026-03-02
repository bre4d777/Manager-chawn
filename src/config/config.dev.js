export const devConfig = {
	token: process.env.TOKEN,
	clientId: '1031120600858624000',
	cache: {
		type: 'redis',
		url: process.env.REDIS_URL,
		fallback: 'memory',
		maxSize: 50000,
		flushOnStart: false,
		flushOnShutdown: false,
	},
	database: {
		url: process.env.DATABASE_URL,
		max_connections: 10,
		connect_timeout: 10,
		max_lifetime: 60,
		logger: false,
	},
	debug: true,
};
