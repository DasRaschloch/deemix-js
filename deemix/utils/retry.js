async function retry(requestFunction, maxRetries = 3, initialDelay = 5000) {
    let attempt = 0;
    let delay = initialDelay;

    while (true) {
        try {
            return await requestFunction(); // Attempt to call the request function
        } catch (error) {
            if (attempt < maxRetries) {
                await new Promise(res => setTimeout(res, delay)); // Wait before retrying
                delay *= 2; // Exponential backoff
                attempt++;
            } else {
                error.message = `Function failed after ${attempt} attempts: ${error.message}`;
                throw error;
            }
        }
    }
}

module.exports = {
    retry,
};