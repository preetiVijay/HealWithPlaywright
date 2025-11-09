import { test, expect } from '@playwright/test';
import { healSelector } from '../healing/aiLocator';
import { LoginPage } from '../pageobjects/LoginPage';
import fs from 'fs';
import path from 'path';

test('Login with valid credentials', async ({ page }) => {
    await page.goto('https://www.saucedemo.com/');
    // Intentionally use the stable selectors for normal run. The healer is exercised by failing selectors.
    const loginPage = new LoginPage(page);

    // User tries to login with valid credentials
    await loginPage.login('standard_user', 'secret_sauce');
    // Verify successful login by checking if the inventory list is visible
    await expect(page.locator('.inventory_list')).toBeVisible();
});

test('Login with invalid credentials', async ({ page }) => {
    await page.goto('https://www.saucedemo.com/');
    // Intentionally use the stable selectors for normal run. The healer is exercised by failing selectors.
    const loginPage = new LoginPage(page);

    // User tries to login with invalid credentials
    await loginPage.login('standard', 'secret_sauce');
    const errorMessage = 'Epic sadface: Username and password do not match any user in this service';
    // Verify successful login by checking if the inventory list is visible
    expect(await page.locator("h3[data-test='error']").textContent()).toContain(errorMessage);
});

test('Login with invalid locator, healing with AI healing)', async ({ page }) => {
    await page.goto('https://www.saucedemo.com/');
    
        // Fill valid creds
        await page.locator('#user-name').fill('standard_user');
        await page.locator('#password').fill('secret_sauce');
    
        const broken = '#login-button-invalid';
        console.log(`Trying original selector: ${broken}`);
    
        // Try original
        try {
          await page.click(broken, { timeout: 2000 });
        } catch {
          console.warn(`Original selector "${broken}" failed — attempting healer`);
    
          const html = await page.content();
    
          // Heuristic-first; do NOT allow AI unless you pass allowAI: true
          const suggestion = await healSelector(broken, html, {
            preferHeuristic: true,
            allowAI: false // set true if you want AI fallback and have OPENAI_API_KEY
          });
    
          if (!suggestion) {
            throw new Error('Healer could not produce a selector');
          }
    
          console.log(`Using healed selector: ${suggestion}`);
    
          // Validate the healed selector actually resolves
          const count = await page.locator(suggestion).count();
          console.log(`Healed selector matches ${count} element(s).`);
          expect(count).toBeGreaterThan(0);
    
          // Click it
          await page.click(suggestion, { timeout: 5000 });
        }
    
        // Verify navigation succeeded
        await expect(page).toHaveURL(/.*inventory/);
  });


