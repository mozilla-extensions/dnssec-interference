/* global browser */

const rollout = {
    async test() {
        try {
            await browser.experiments.udpsocket.connect();
        } catch(e) {
            console.log(e);
        }
    }
}

rollout.test();
