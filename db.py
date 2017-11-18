# -*- coding: utf-8 -*-
import timeit
import collections
import pandas as pd
from PyQt5 import QtCore


def init():
    """Function to initialize all variables"""

    global j, matrix, parameters, functions_timer, time_start
    global calc, results, performed, unperformed, unperformed2, result_pandas, jobs_destroyed
    global b_calc, b_results, b_performed, b_unperformed
    global i_calc, i_results, i_performed, i_unperformed
    global c_calc, c_results, c_performed, c_unperformed

    parameters = {
            '_instance_name': 'instance',
            '_best_fitness' : 'instance',
            '_total_jobs': 'instance',
            '_initial_setup': 'instance',
            '_stop_time': 2,
            '_jobs_to_destroy': 2,
            '_total_families': 'instance',
            '_permutation': True,
            '_solution_to_destroy': 'best',
            '_end_max': 'instance'}

    results = {
            'fitness_iteration': 0,
            'fitness_runtime': 0,
            'runtime': 0,
            'iterations': 0,
            'log': []}

    functions_timer = collections.defaultdict(list)
    time_start = timeit.default_timer()
    
    j, jobs_destroyed, matrix = [], [], []
    calc, performed, unperformed, unperformed2 = [], [], [], []
    b_calc, b_results, b_performed, b_unperformed = [], {}, [], []
    i_calc, i_results, i_performed, i_unperformed = [], {}, [], []
    c_calc, c_results, c_performed, c_unperformed = [], {}, [], []
    result_pandas, matrix_pandas, j_pandas = [], [], []

    """calc = [0]  Job Number
              [1]  Processed?   0 - NO /  1 - YES / 2 - NEVER
              [2]  Setup Time                      
              [3]  Setup Cost                      
              [4]  Deadline (Dynamic Value, Sequence dependent)                        
              [5]  Slack Time (Create just for Analyses purposes)
              [6]  Start Max
              [7]  Start Setup Time
              [8]  Start Process Time
              [9]  Finish Time Process
              [10] Penalty Cost
              [11] Total Cost """


def init_gui():
    """Function to initialize all GUI variables"""
    global instance, j_pandas, j_pandas_describe, result_pandas, matrix_pandas
    instance = 0
    j_pandas, j_pandas_describe = [], [] #, result_pandas = [], [], []
    #matrix_pandas =[]


class Jobs:
    """Class to generate job objects """
    def __init__(self, setup_family, release_date, due_date,
                 process_time, mode_cost, unperformed_cost, tardiness_cost):
        # self._name = name
        self._setup_family = setup_family
        self._release_date = release_date
        self._due_date = due_date
        self._process_time = process_time
        self._mode_cost = mode_cost
        self._unperformed_cost = unperformed_cost
        self._tardiness_cost = tardiness_cost

    def __eq__(self, other):
        return self.__dict__ == other.__dict__


class PandasModel(QtCore.QAbstractTableModel):
    """ Credits to Elias from Stack Overflow for this class
        https://stackoverflow.com/questions/44603119/how-to-display-a-pandas-data-frame-with-pyqt5"""
    def __init__(self, df=pd.DataFrame(), parent=None):
        QtCore.QAbstractTableModel.__init__(self, parent=parent)
        self._df = df

    def headerData(self, section, orientation, role=QtCore.Qt.DisplayRole):
        if role != QtCore.Qt.DisplayRole:
            return QtCore.QVariant()

        if orientation == QtCore.Qt.Horizontal:
            try:
                return self._df.columns.tolist()[section]
            except (IndexError, ):
                return QtCore.QVariant()
        elif orientation == QtCore.Qt.Vertical:
            try:
                # return self.df.index.tolist()
                return self._df.index.tolist()[section]
            except (IndexError, ):
                return QtCore.QVariant()

    def data(self, index, role=QtCore.Qt.DisplayRole):
        if role != QtCore.Qt.DisplayRole:
            return QtCore.QVariant()

        if not index.isValid():
            return QtCore.QVariant()

        return QtCore.QVariant(str(self._df.ix[index.row(), index.column()]))

    def setData(self, index, value, role):
        row = self._df.index[index.row()]
        col = self._df.columns[index.column()]
        if hasattr(value, 'toPyObject'):
            # PyQt4 gets a QVariant
            value = value.toPyObject()
        else:
            # PySide gets an unicode
            dtype = self._df[col].dtype
            if dtype != object:
                value = None if value == '' else dtype.type(value)
        self._df.set_value(row, col, value)
        return True

    def rowCount(self, parent=QtCore.QModelIndex()):
        return len(self._df.index)

    def columnCount(self, parent=QtCore.QModelIndex()):
        return len(self._df.columns)

    def sort(self, column, order):
        colname = self._df.columns.tolist()[column]
        self.layoutAboutToBeChanged.emit()
        self._df.sort_values(colname, ascending= order == QtCore.Qt.AscendingOrder, inplace=True)
        self._df.reset_index(inplace=True, drop=True)
        self.layoutChanged.emit()