# -*- coding: utf-8 -*-

from design import Ui_MainWindow
from PyQt5 import QtWidgets, QtGui, QtCore
from os import path
import os
import load
import timeit
import json
import sys
import db
import ig
import numpy as np
from PyQt5.QtWidgets import QVBoxLayout
import matplotlib.pyplot as plt
import matplotlib
from matplotlib.backends.backend_qt5agg import FigureCanvasQTAgg as FigureCanvas
from matplotlib.backends.backend_qt5agg import NavigationToolbar2QT as NavigationToolbar
import random
import ctypes

if os.name != 'posix':
    ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID('metaheuristic.iteratedgreedy')  # to appears the ico

matplotlib.rcParams.update({'font.size': 8})

def create_graphic():
    global figure_instance, figure_results, canvas_instance, figure_results

    #toolbar_instance = NavigationToolbar(canvas_instance, None)
    layout_instance = QVBoxLayout()
    #layout_instance.addWidget(toolbar_instance)
    layout_instance.addWidget(canvas_instance)
    ui.verticalLayout_instance.addLayout(layout_instance)


    toolbar_results = NavigationToolbar(canvas_results, None)
    layout_results = QVBoxLayout()
    layout_results.addWidget(toolbar_results)
    layout_results.addWidget(canvas_results)
    ui.verticalLayout_results.addLayout(layout_results)


def change_graphic_results():
    global figure_results, canvas_results
    figure_results.clear()
    ax = figure_results.add_subplot(111)
    ax.set_title('Solutions found during Runtime')
    ax.plot(db.results['log']['Runtime'][:-1], db.results['log']['Solution'][:-1], '.-', markersize=10)
    #ax.set_ylim([db.parameters['_best_fitness'] * 0.9995, int(db.results['log']['Solution'][:-1].tail(1)) * 1.0005])
    #ax.set_xlim([0, db.results['log']['Runtime'][0] * 1.0005])
    ax.set_xlim(xmin=0)
    ax.set_ylim(ymin=db.parameters['_best_fitness'])
    ax.set_xlabel('Time (sec)')
    ax.set_ylabel('Solution')
    ax.grid(True)
    canvas_results.draw()


def change_graphic_instance():
    global figure_instance, canvas_instance
    figure_instance.clear()

    ax = figure_instance.add_subplot(321)
    ax.set_title('Start Min')
    ax.hist(db.j_pandas['START_MIN'])
    ax = figure_instance.add_subplot(322)
    
    ax.set_title('Due Time')
    ax.hist(db.j_pandas['DUE_TIME'])
    ax = figure_instance.add_subplot(323)

    ax.set_title('Processing Time')
    ax.hist(db.j_pandas['PROCESSING_TIME'])
    ax = figure_instance.add_subplot(324)
    
    ax.set_title('Unperformed Cost')
    ax.hist(db.j_pandas['UNPERFORMED_COST'])
    ax = figure_instance.add_subplot(325)
    
    ax.set_title('Mode Cost')
    ax.hist(db.j_pandas['MODE_COST'])
    ax = figure_instance.add_subplot(326)
    
    ax.set_title('Tardiness Variable Cost')
    ax.hist(db.j_pandas['TARDINESS_VARIABLE_COST'])

    figure_instance.subplots_adjust(left=0.1, right=0.9, bottom=0.1, top=0.9, hspace=1.1, wspace=0.3)
    #figure_instance.tight_layout()
    canvas_instance.draw()


def dock_set_size():
    ui.dockWidget_par.widget().setMinimumSize(515, 365)
    ui.dockWidget_par.widget().setMaximumSize(515, 365)

    #myPixmap = QtGui.QPixmap("Exchange.jpg")
    #myScaledPixmap = myPixmap.scaled(ui.label_exchange.size(), Qt.KeepAspectRatio)
    #ui.label_exchange.setPixmap(myScaledPixmap)

    ui.label_exchange.setScaledContents(True)
    image = path.join(path.dirname(__file__), path.join("images", "swap.png"))
    ui.label_exchange.setPixmap(QtGui.QPixmap(image))

    ui.label_ig.setScaledContents(True)
    image = path.join(path.dirname(__file__), path.join("images", "ig.png"))
    ui.label_ig.setPixmap(QtGui.QPixmap(image))

    ui.label_insert.setScaledContents(True)
    image = path.join(path.dirname(__file__), path.join("images", "insert.png"))
    ui.label_insert.setPixmap(QtGui.QPixmap(image))

    ui.label_destroy.setScaledContents(True)
    image = path.join(path.dirname(__file__), path.join("images", "destroy.png"))
    ui.label_destroy.setPixmap(QtGui.QPixmap(image))

    #ui.label_destroy.pixmap().scaled(ui.label_destroy.width(), ui.label_destroy.height())
def combo_box():
    ui.comboBox_instance.addItems(benchmark.keys())
    ui.comboBox_instance.currentIndexChanged.connect(combo_box_change)

    ui.comboBox_instance.setStyleSheet("QComboBox {combobox-popup: 0 }")
    ui.comboBox_instance.setMaxVisibleItems(10)
    ui.comboBox_instance.setCurrentIndex(1)  # 30 is the first os STC
    ui.tableView_parameters_jobs.verticalHeader().setVisible(False)
    ui.tableView_parameters_jobs.resizeColumnsToContents()
    ui.tableView_parameters_jobs.resizeRowsToContents()

    ui.tableView_parameters_setup.resizeRowsToContents()
    ui.tableView_parameters_setup.verticalHeader().setVisible(False)

    ui.tableView_instance_stats.resizeRowsToContents()
    ui.tableView_instance_stats.resizeColumnsToContents()
    ui.comboBox_instance.setCurrentIndex(0)
    ui.tabWidget_master.setCurrentIndex(2)  # start showing the about
def combo_box_change():

    db.instance = ui.comboBox_instance.currentText()
    ui.tabWidget_master.setTabText(0, 'Instance: {}'.format(db.instance))
    # JSON

    ui.lineEdit_best_solution.setText(str(benchmark[db.instance][1]))
    ui.lineEdit_jobs.setText(str(benchmark[db.instance][0]))
    ui.lineEdit_time_limit.setText(str(30 * benchmark[db.instance][0]))
    ui.lineEdit_setup.setText('Yes' if db.instance.find('STC') != -1 else 'No')
    ui.lineEdit_tardiness.setText('Yes' if db.instance[-1] != 'a' else 'No')
    ui.lineEdit_lp.setText(benchmark[db.instance][2])
    ui.lineEdit_greedy.setText(str(benchmark[db.instance][3]))
    ui.lineEdit_descent.setText(str(benchmark[db.instance][4]))
    ui.lineEdit_tabu.setText(benchmark[db.instance][5])
    ui.lineEdit_tabudiv.setText(benchmark[db.instance][6])
    ui.lineEdit_amamen.setText(benchmark[db.instance][7])
    ui.lineEdit_amasp.setText(benchmark[db.instance][8])
    ui.lineEdit_ig.setText(benchmark[db.instance][9])

    i_path = path.join(path.dirname(__file__), path.join('masclib', str(db.instance) + '.csv'))
    #i_path = path.join('masclib', str(db.instance) + '.csv')
    load.load_pandas(i_path)
    ui.plainTextEdit.clear()
    ui.tabWidget_master.setCurrentIndex(0)
    #ui.tabWidget_instance.setCurrentIndex(3)

    # CSV
    txt = open(i_path).read()
    ui.plainTextEdit.appendPlainText(txt)
    ui.plainTextEdit.verticalScrollBar().setValue(0)
    #ui.tabWidget_instance.setCurrentIndex(0)

    #Instance Parameters
    parameters = db.PandasModel(db.j_pandas)
    ui.tableView_parameters_jobs.setModel(parameters)

    #Setup
    parameters = db.PandasModel(db.matrix_pandas)
    ui.tableView_parameters_setup.setModel(parameters)
    ui.lineEdit_initial_setup.setText(str(db.parameters['_initial_setup']))

    #descriptive statistic
    parameters = db.PandasModel(db.j_pandas_describe)
    ui.tableView_instance_stats.setModel(parameters)

    change_graphic_instance()
    plt.close(figure_instance)  # to not print when the app is close

def button_clicked():

    ui.tabWidget_master.setTabText(1, 'Results: {}'.format(db.instance))
    #functions.reset_variables()
    db.init()
    ui.label_status.setText('Results: {}'.format(db.instance))
    db.parameters['_best_fitness'] = int(ui.lineEdit_best_solution.text())
    db.parameters['_stop_time'] = int(ui.lineEdit_time_limit.text())

    if ui.radioButton_fixed.isChecked():
        db.parameters['_jobs_to_destroy'] = int(ui.spinBox_fixed.text())
    elif ui.radioButton_random.isChecked():
        db.parameters['_jobs_to_destroy'] = [int(ui.spinBox_r_min.text()), int(ui.spinBox_r_max.text())]
    else:
        db.parameters['_jobs_to_destroy'] = [int(ui.spinBox_r_min.text()), int(ui.spinBox_r_max.text()),
                                             int(ui.spinBox_r_mode.text())]

    db.parameters['_solution_to_destroy'] = 'best' if ui.radioButton_candidate.isChecked() else 'candidate'
    db.parameters['_permutation'] = ui.checkBox_permutation.isChecked()

    instance_path = path.join(path.dirname(__file__), path.join('masclib', str(db.instance) + '.csv'))
    db.time_start = timeit.default_timer()
    load.load_regex(instance_path)
    ig.ig()
    change_graphic_results()
    plt.close(figure_results)  # to not print when the app is close
    ui.tabWidget_master.setCurrentIndex(1)
    #ui.tabWidget_results.setCurrentIndex(0)

    # print the results inside the lineEdit
    ui.lineEdit_res_candidate.setText(str(db.results['fitness_runtime']))
    ui.lineEdit_res_runtime.setText(str(round(db.results['runtime'], 2)))
    ui.lineEdit_res_iterations.setText(str(db.results['iterations'] - 1))
    ui.lineEdit_res_gap.setText(str(round(100 * (db.results['fitness_runtime'] - db.parameters['_best_fitness'])
                                          / db.parameters['_best_fitness'], 2)))
    ui.lineEdit_res_improv.setText(str(round(100 - 100 * db.results['fitness_runtime']
                                             / db.results['log'].Solution.iloc[-2], 2)))
    ui.lineEdit_res_perf.setText(str(len(db.performed)))
    ui.lineEdit_res_unperf.setText(str(len(db.unperformed + db.unperformed2)))

    results = db.PandasModel(db.result_pandas)
    ui.tableView_results.setModel(results)

    results = db.PandasModel(db.results['log'])
    ui.tableView_log.setModel(results)


    results = db.PandasModel(db.functions_timer)
    ui.tableView_performance.setModel(results)

    ui.tableView_log.resizeColumnToContents(0)
    ui.tableView_log.resizeColumnToContents(1)
    ui.tableView_log.resizeColumnToContents(2)


    ui.tableView_results.resizeColumnsToContents()
    ui.tableView_results.resizeRowsToContents()

    ui.tableView_performance.resizeRowsToContents()
    ui.tableView_performance.verticalHeader().setVisible(False)
    ui.tableView_performance.resizeColumnsToContents()



def fixed_clicked():
    ui.spinBox_fixed.setVisible(True)
    ui.spinBox_r_max.setVisible(False)
    ui.spinBox_r_min.setVisible(False)
    ui.label_min.setVisible(False)
    ui.label_max.setVisible(False)
    ui.label_mode.setVisible(False)
    ui.spinBox_r_mode.setVisible(False)


def random_clicked():
    ui.spinBox_fixed.setVisible(False)
    ui.label_mode.setVisible(False)
    ui.spinBox_r_max.setVisible(True)
    ui.spinBox_r_min.setVisible(True)
    ui.spinBox_r_mode.setVisible(False)
    ui.label_min.setVisible(True)
    ui.label_max.setVisible(True)


def triangular_clicked():
    ui.spinBox_fixed.setVisible(False)
    ui.spinBox_r_max.setVisible(True)
    ui.spinBox_r_min.setVisible(True)
    ui.label_min.setVisible(True)
    ui.label_max.setVisible(True)
    ui.label_mode.setVisible(True)
    ui.spinBox_r_mode.setVisible(True)


def performance_click():
    f_name = ui.tableView_performance.currentIndex().data()
    try:
        if f_name == 'load_regex':
            ui.textBrowser_f_description.setText(getattr(load, f_name).__doc__)
        else:
            ui.textBrowser_f_description.setText(getattr(ig, f_name).__doc__)
    except AttributeError:
        pass


def open_home(self):
    url = QtCore.QUrl('https://github.com/alexmarinho/IG')
    if not QtGui.QDesktopServices.openUrl(url):
        QtGui.QMessageBox.warning(self, 'Open Url', 'Could not open url')


def open_feedback(self):
    url = QtCore.QUrl('https://github.com/alexmarinho/IG/issues')
    if not QtGui.QDesktopServices.openUrl(url):
        QtGui.QMessageBox.warning(self, 'Open Url', 'Could not open url')

def about(self):
    About = QtWidgets.QDialog()
    ui = ig.Ui_About()
    ui.setupUi(About)
    About.show()
    About.exec_()

if __name__ == "__main__":
    db.init_gui()
    db.init()
    figure_results = plt.figure()
    figure_instance = plt.figure()
    canvas_results = FigureCanvas(figure_results)
    canvas_instance = FigureCanvas(figure_instance)

    with open('benchmark.json') as json_file:
        benchmark = json.load(json_file)

    app = QtWidgets.QApplication.instance()
    if app is None:
        app = QtWidgets.QApplication(sys.argv)

    # set app icon

    ico = path.join(path.dirname(__file__), path.join("images", "ico.png"))
    app_icon = QtGui.QIcon()
    app_icon.addFile('ico', QtCore.QSize(32, 32))
    app_icon.addFile('ico', QtCore.QSize(16, 16))
    app_icon.addFile('ico', QtCore.QSize(24, 24))
    app_icon.addFile('ico', QtCore.QSize(48, 48))
    app_icon.addFile('ico', QtCore.QSize(256, 256))
    #app.setWindowIcon(app_icon)
    app.setWindowIcon(QtGui.QIcon(ico))


    MainWindow = QtWidgets.QMainWindow()
    ui = Ui_MainWindow()
    ui.setupUi(MainWindow)


    # Call functions
    dock_set_size()
    combo_box()
    fixed_clicked()
    create_graphic()

    # Actions
    ui.pushButton_run.clicked.connect(button_clicked)
    ui.radioButton_fixed.clicked.connect(fixed_clicked)
    ui.radioButton_random.clicked.connect(random_clicked)
    ui.radioButton_triangular.clicked.connect(triangular_clicked)
    ui.tableView_performance.doubleClicked.connect(performance_click)
    ui.actionIG_Project.triggered.connect(open_home)
    ui.actionBugs_Feedback.triggered.connect(open_feedback)
    ui.actionAbout.triggered.connect(about)
    # lambda works to call function directly w/out creating separate function
    #ui.pushButton.clicked.connect(lambda: ui.pushButton.setText('Button was clicked'))


    ui.textBrowser_11.setOpenExternalLinks(True)
    MainWindow.show()
    sys.exit(app.exec_())
