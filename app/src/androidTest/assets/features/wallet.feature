Feature: Wallet
  As a user
  I want to view my wallet balance
  So that I can manage my coins

  Scenario: Wallet shows balance and transactions button
    Given I am on the main screen
    When I tap the "Profile" tab
    And I tap the element with tag "profile_walletButton"
    Then I should see the element with tag "wallet_balance"
    And I should see the element with tag "wallet_transactionsButton"

  Scenario: Navigate to transaction history
    Given I am on the main screen
    When I tap the "Profile" tab
    And I tap the element with tag "profile_walletButton"
    And I tap the element with tag "wallet_transactionsButton"
    Then I should see the element with tag "transactions_list"
