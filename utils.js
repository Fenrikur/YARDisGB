module.exports = {
	millisecondsToText: function (milliseconds, useOnlyBiggestUnit) {
		const parts = [];
		let remainder = milliseconds / 1000;

		const seconds = useOnlyBiggestUnit ? (Math.round(remainder * 100) / 100) : Math.floor(remainder % 60);
		remainder /= 60;
		const minutes = useOnlyBiggestUnit ? (Math.round(remainder * 100) / 100) : Math.floor(remainder % 60);
		remainder /= 60;
		const hours = useOnlyBiggestUnit ? (Math.round(remainder * 100) / 100) : Math.floor(remainder % 24);
		remainder /= 24;
		const days = useOnlyBiggestUnit ? (Math.round(remainder * 100) / 100) : Math.floor(remainder % 7);
		const weeks = useOnlyBiggestUnit ? Math.round(remainder * 100 / 7) / 100 : Math.floor(remainder / 7);

		if (weeks >= 1) {
			parts.push(`${weeks} week${(weeks === 1) ? '' : 's'}`);
		}
		if (days >= 1) {
			parts.push(`${days} day${(days === 1) ? '' : 's'}`);
		}
		if (hours >= 1) {
			parts.push(`${hours} hour${(hours === 1) ? '' : 's'}`);
		}
		if (minutes >= 1) {
			parts.push(`${minutes} minute${(minutes === 1) ? '' : 's'}`);
		}
		if (seconds >= 0) {
			parts.push(`${seconds} second${(seconds === 1) ? '' : 's'}`);
		}

		return useOnlyBiggestUnit ? parts[0] : parts.join(' ');
	},
};