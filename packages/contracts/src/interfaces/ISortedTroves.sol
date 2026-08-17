// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title ISortedTroves
 * @notice Doubly-linked list of troves ordered by NICR, descending. Verified live on matsnet
 *         0x722E4D24FD6Ff8b0AC679450F3D91294607268fA (229 troves on 2026-08-15).
 * @dev Maren never calls these on-chain — hints are computed off-chain and passed in as
 *      arguments, because walking this list on-chain is unbounded gas. The interface exists
 *      so scripts and tests can compute hints the same way the keeper does.
 */
interface ISortedTroves {
    function findInsertPosition(uint256 _NICR, address _prevId, address _nextId)
        external
        view
        returns (address, address);

    function getSize() external view returns (uint256);

    function getFirst() external view returns (address);

    function getLast() external view returns (address);

    /// @notice The next node walking DOWN the list, i.e. towards lower NICR. `getNext` of the
    ///         tail is the zero address (verified live on matsnet 2026-08-17).
    function getNext(address _id) external view returns (address);

    /// @notice The previous node walking UP the list, i.e. towards higher NICR.
    function getPrev(address _id) external view returns (address);

    function contains(address _id) external view returns (bool);
}
