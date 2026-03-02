import 'dotenv/config';

export const prodConfig = {
	token: process.env.TOKEN,
	clientId: '1277525844319014955',
	cache: {
		type: 'redis',
		url: process.env.REDIS_URL,
		fallback: 'memory',
		maxSize: 100000,
		flushOnStart: false,
		flushOnShutdown: false,
	},
	database: {
		url: process.env.DATABASE_URL,
		max_connections: 20,
		connect_timeout: 10,
		max_lifetime: 60,
		logger: false,
	},
	debug: false,
};
