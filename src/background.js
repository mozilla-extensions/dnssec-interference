/* global browser */

const rollout = {
    async test() {
        let result = await browser.experiments.udpsocket.connect();
        console.log(result);
    }
}

rollout.test();
