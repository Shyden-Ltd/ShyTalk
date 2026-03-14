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

  Scenario: Wallet screen shows balance when launched directly
    Given I am on the "wallet" screen
    When I wait for the element with tag "wallet_balance"
    Then I should see the element with tag "wallet_balance"

  Scenario: Transactions button navigates to transaction list when launched directly
    Given I am on the "wallet" screen
    When I wait for the element with tag "wallet_transactionsButton"
    And I tap the element with tag "wallet_transactionsButton"
    Then I should see the element with tag "transactions_list"

  Scenario: Transaction history screen shows transaction list when launched directly
    Given I am on the "transactions" screen
    When I wait for the element with tag "transactions_list"
    Then I should see the element with tag "transactions_list"

  # Skipped: transactionHistory_backButton_returnsToWallet — uses Espresso.pressBack()
  # which cannot be expressed with available step definitions.
