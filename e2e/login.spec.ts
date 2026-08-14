import { expect, test } from '@playwright/test';

test.describe('login smoke flow', () => {
  test('loads the portal and validates authentication input', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle(/MMSS Mohali - Student Portal/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText('Please enter your student ID.');

    await page.getByRole('tab', { name: 'Teacher' }).click();
    await expect(page.getByLabel('Teacher ID')).toBeVisible();

    const passwordHelpButton = page.getByRole('button', { name: 'Forgot password?' });
    await expect(passwordHelpButton).toHaveCount(1);
    await passwordHelpButton.click();
    await expect(page.getByRole('dialog', { name: 'Forgot password?' })).toBeVisible();
    await expect(page.getByRole('link', { name: /open school portal/i })).toHaveAttribute(
      'target',
      '_blank',
    );
  });
});
