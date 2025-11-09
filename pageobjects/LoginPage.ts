import { Locator, Page } from "@playwright/test";
import { healSelector } from '../healing/aiLocator';

export class LoginPage {

    page: Page;
    username: Locator;
    password: Locator;
    loginButton: Locator;

    constructor(page: Page){
        this.page = page;
        this.username = page.locator('#user-name');
        this.password = page.locator('#password');
        this.loginButton = page.locator('#login-button');
    }

    async login(username: string, password:string){
        await this.username.fill(username);
        await this.password.fill(password);
        // attempt click; if it fails, call healer
        try {
            await this.loginButton.click();
        }
        catch (err) {
            console.warn('Initial click failed, invoking healer...');
            const dom = await this.page.content();
            const suggestion = await healSelector('#login-button', dom);
            if (suggestion) {
                console.log('AI suggestion:', suggestion);
                await this.page.click(suggestion);
            } else {
                throw err;
            }
        }   
    }

}